import { getAgentSubject } from "../agentConfig.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isRecord } from "../utils/object.ts";
import type { SlackContext } from "./slackContext.ts";

const MAX_SLACK_SECTION_TEXT_LENGTH = 1000;
const MAX_SLACK_MESSAGE_TEXT_LENGTH = MAX_SLACK_SECTION_TEXT_LENGTH;
const SLACK_MESSAGE_RETRY_DELAY_MS = 2000;

const THINKING_CONTEXT_TEXT = `:loading-dots: ${getAgentSubject()} 생각 중이에요`;

type SlackMessageBlock = Record<string, unknown>;

type SlackMessagePayload = {
  text: string;
  blocks: SlackMessageBlock[];
};

type SlackTextSegment = {
  type: "text" | "code";
  value: string;
};

const splitByPattern = (text: string, pattern: RegExp, matchType: SlackTextSegment["type"]): SlackTextSegment[] => {
  const segments: SlackTextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index;
    if (typeof matchIndex !== "number") {
      continue;
    }

    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }

    segments.push({ type: matchType, value: match[0] });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
};

const convertMarkdownInline = (text: string): string => {
  let updated = text;
  updated = updated.replace(/\*\*([\s\S]+?)\*\*/g, "*$1*");
  updated = updated.replace(/__([\s\S]+?)__/g, "*$1*");
  updated = updated.replace(/~~([\s\S]+?)~~/g, "~$1~");
  updated = updated.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");
  return updated;
};

const normalizeSlackMrkdwn = (text: string): string => {
  const fencedSegments = splitByPattern(text, /```[\s\S]*?```/g, "code");
  return fencedSegments
    .map((segment) => {
      if (segment.type === "code") {
        return segment.value;
      }

      const inlineSegments = splitByPattern(segment.value, /`[^`]*`/g, "code");
      return inlineSegments
        .map((inline) => (inline.type === "code" ? inline.value : convertMarkdownInline(inline.value)))
        .join("");
    })
    .join("");
};

type SlackSegmentState = {
  ts: string;
  text: string;
  includeThinking: boolean;
};

const splitSlackTextByLength = (text: string, maxLength: number): string[] => {
  if (text.length <= maxLength) {
    return [text];
  }

  const segments: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    const maxEnd = Math.min(offset + maxLength, text.length);
    if (maxEnd === text.length) {
      segments.push(text.slice(offset));
      break;
    }

    const lastNewline = text.lastIndexOf("\n", maxEnd - 1);
    if (lastNewline >= offset) {
      const nextOffset = lastNewline + 1;
      segments.push(text.slice(offset, nextOffset));
      offset = nextOffset;
      continue;
    }

    segments.push(text.slice(offset, maxEnd));
    offset = maxEnd;
  }
  return segments;
};

export class SlackThreadOutput {
  private slack: SlackContext;
  private segmentStates: SlackSegmentState[] = [];
  private lastMessageCreateFailedAt = 0;
  private updateChain: Promise<void> = Promise.resolve();

  constructor(slack: SlackContext) {
    this.slack = { ...slack };
  }

  updateSlackContext(next: SlackContext): void {
    this.slack = { ...next };
  }

  resetForTurn(): void {
    this.segmentStates = [];
    this.lastMessageCreateFailedAt = 0;
  }

  getOutputMessageTs(): string | null {
    if (this.segmentStates.length === 0) {
      return null;
    }
    return this.segmentStates[this.segmentStates.length - 1].ts;
  }

  async showThinkingIndicator(): Promise<boolean> {
    return this.update("", { includeThinking: true });
  }

  async update(text: string, options?: { includeThinking?: boolean }): Promise<boolean> {
    const includeThinking = options?.includeThinking ?? true;
    const task = async (): Promise<boolean> => {
      const trimmed = text.trim();
      const normalized = trimmed.length > 0 ? normalizeSlackMrkdwn(trimmed) : "";
      const textSegments =
        normalized.length > 0 ? splitSlackTextByLength(normalized, MAX_SLACK_MESSAGE_TEXT_LENGTH) : [];
      let desiredSegments: string[] = [];
      if (textSegments.length > 0) {
        desiredSegments = textSegments;
      } else if (includeThinking) {
        desiredSegments = [""];
      }

      if (desiredSegments.length === 0) {
        return false;
      }

      for (let index = this.segmentStates.length; index < desiredSegments.length; index += 1) {
        const segmentText = desiredSegments[index];
        const payload = this.buildSlackMessagePayload(segmentText, {
          includeThinking: includeThinking && segmentText.length === 0,
        });
        if (!payload) {
          break;
        }

        const ts = await this.postSegmentMessage(payload);
        if (!ts) {
          break;
        }

        this.segmentStates.push({
          ts,
          text: segmentText,
          includeThinking: includeThinking && segmentText.length === 0,
        });
      }

      const visibleCount = this.segmentStates.length;
      if (visibleCount === 0) {
        return false;
      }

      const lastOutputIndex = Math.min(desiredSegments.length, visibleCount) - 1;
      let updatedLast = false;

      for (let index = 0; index < visibleCount; index += 1) {
        const state = this.segmentStates[index];
        const nextText = index < desiredSegments.length ? desiredSegments[index] : state.text;
        const nextIncludeThinking = includeThinking && index === lastOutputIndex;

        if (state.text === nextText && state.includeThinking === nextIncludeThinking) {
          if (index === lastOutputIndex) {
            updatedLast = true;
          }
          continue;
        }

        const payload = this.buildSlackMessagePayload(nextText, { includeThinking: nextIncludeThinking });
        if (!payload) {
          continue;
        }

        const updated = await SlackSDK.instance
          .updateMessage({
            channel: this.slack.channelId,
            ts: state.ts,
            text: payload.text,
            blocks: payload.blocks,
          })
          .then(() => true)
          .catch(() => false);

        if (!updated) {
          continue;
        }

        state.text = nextText;
        state.includeThinking = nextIncludeThinking;
        if (index === lastOutputIndex) {
          updatedLast = true;
        }
      }

      return updatedLast;
    };

    const next = this.updateChain.then(task, task);
    this.updateChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private buildSlackMessagePayload(text: string, options: { includeThinking: boolean }): SlackMessagePayload | null {
    const hasText = text.length > 0;
    const sectionTexts = hasText ? splitSlackTextByLength(text, MAX_SLACK_SECTION_TEXT_LENGTH) : [];
    const blocks: SlackMessageBlock[] = [];

    if (hasText) {
      for (const sectionText of sectionTexts) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: sectionText },
          expand: true,
        });
      }
    }

    if (options.includeThinking) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: THINKING_CONTEXT_TEXT }],
      });
    }

    if (blocks.length === 0) {
      return null;
    }

    return { text: hasText ? text : THINKING_CONTEXT_TEXT, blocks };
  }

  private async postSegmentMessage(payload: SlackMessagePayload): Promise<string | null> {
    const now = Date.now();
    if (now - this.lastMessageCreateFailedAt < SLACK_MESSAGE_RETRY_DELAY_MS) {
      return null;
    }

    const placeholder = await SlackSDK.instance
      .postMessage({
        channel: this.slack.channelId,
        thread_ts: this.slack.threadTs ?? this.slack.messageTs,
        text: payload.text,
        blocks: payload.blocks,
      })
      .catch(() => null);

    const ts = isRecord(placeholder) && typeof placeholder.ts === "string" ? placeholder.ts : null;
    if (!ts) {
      this.lastMessageCreateFailedAt = now;
      return null;
    }

    return ts;
  }
}
