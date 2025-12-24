import { getAgentSubject } from "../agentConfig.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isRecord } from "../utils/object.ts";
import type { SlackContext } from "./slackContext.ts";

const MAX_SLACK_TEXT_LENGTH = 38_000;

const THINKING_CONTEXT_TEXT = `:loading-dots: ${getAgentSubject()} 생각 중이에요`;

type SlackMessageBlock = Record<string, unknown>;

type SlackMessagePayload = {
  text: string;
  blocks: SlackMessageBlock[];
};

const trimSlackText = (text: string): string => {
  if (text.length <= MAX_SLACK_TEXT_LENGTH) {
    return text;
  }
  return `...(truncated)\n\n${text.slice(text.length - MAX_SLACK_TEXT_LENGTH)}`;
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

export class SlackThreadOutput {
  private slack: SlackContext;
  private outputMessageTs: string | null = null;
  private lastEnsureOutputAt = 0;

  constructor(slack: SlackContext) {
    this.slack = { ...slack };
  }

  updateSlackContext(next: SlackContext): void {
    this.slack = { ...next };
  }

  resetForTurn(): void {
    this.outputMessageTs = null;
    this.lastEnsureOutputAt = 0;
  }

  getOutputMessageTs(): string | null {
    return this.outputMessageTs;
  }

  async showThinkingIndicator(): Promise<boolean> {
    return this.update("", { includeThinking: true });
  }

  async update(text: string, options?: { includeThinking?: boolean }): Promise<boolean> {
    const includeThinking = options?.includeThinking ?? true;
    const payload = this.buildSlackMessagePayload(text, { includeThinking });
    if (!payload) {
      return false;
    }

    const outputTs = await this.ensureOutputMessageTs(payload);
    if (!outputTs) {
      return false;
    }

    await SlackSDK.instance
      .updateMessage({
        channel: this.slack.channelId,
        ts: outputTs,
        text: payload.text,
        blocks: payload.blocks,
      })
      .catch(() => undefined);
    return true;
  }

  private buildSlackMessagePayload(text: string, options: { includeThinking: boolean }): SlackMessagePayload | null {
    const trimmed = text.trim();
    const hasText = trimmed.length > 0;
    const normalized = hasText ? trimSlackText(normalizeSlackMrkdwn(trimmed)) : "";
    const blocks: SlackMessageBlock[] = [];

    if (hasText) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: normalized },
        expand: true,
      });
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

    return { text: hasText ? normalized : THINKING_CONTEXT_TEXT, blocks };
  }

  private async ensureOutputMessageTs(payload: SlackMessagePayload): Promise<string | null> {
    if (this.outputMessageTs) {
      return this.outputMessageTs;
    }

    const now = Date.now();
    if (now - this.lastEnsureOutputAt < 10_000) {
      return null;
    }
    this.lastEnsureOutputAt = now;

    const placeholder = await SlackSDK.instance
      .postMessage({
        channel: this.slack.channelId,
        thread_ts: this.slack.threadTs ?? this.slack.messageTs,
        text: payload.text,
        blocks: payload.blocks,
      })
      .catch(() => null);

    const ts = isRecord(placeholder) && typeof placeholder.ts === "string" ? placeholder.ts : null;
    if (ts) {
      this.outputMessageTs = ts;
    }
    return ts;
  }
}
