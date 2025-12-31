import { getAgentSubject } from "../agentConfig.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isRecord } from "../utils/object.ts";
import type { SlackContext } from "./slackContext.ts";

const MAX_SLACK_SECTION_TEXT_LENGTH = 1000;
const MAX_SLACK_MESSAGE_TEXT_LENGTH = MAX_SLACK_SECTION_TEXT_LENGTH;
const MAX_SLACK_MESSAGE_BLOCKS = 50;
const MAX_SLACK_HEADER_TEXT_LENGTH = 150;
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

const stripSlackMrkdwn = (text: string): string => {
  let stripped = text;
  stripped = stripped.replace(/<([^|>]+)\|([^>]+)>/g, "$2");
  stripped = stripped.replace(/<([^>]+)>/g, "$1");
  stripped = stripped.replace(/`([^`]*)`/g, "$1");
  stripped = stripped.replace(/\*([^*]+)\*/g, "$1");
  stripped = stripped.replace(/_([^_]+)_/g, "$1");
  stripped = stripped.replace(/~([^~]+)~/g, "$1");
  return stripped;
};

const truncatePlainText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  const trimmedLength = Math.max(0, maxLength - 3);
  return `${text.slice(0, trimmedLength)}...`;
};

const trimTrailingNewline = (text: string): string => text.replace(/\r?\n$/, "");

const buildSectionBlocks = (text: string): SlackMessageBlock[] => {
  const segments = splitSlackTextByLength(text, MAX_SLACK_SECTION_TEXT_LENGTH);
  return segments
    .map((segment) => segment.trimEnd())
    .filter((segment) => segment.length > 0)
    .map((segment) => ({
      type: "section",
      text: { type: "mrkdwn", text: segment },
      expand: true,
    }));
};

const buildCodeSectionBlocks = (codeText: string): SlackMessageBlock[] => {
  const fenceOverhead = "```\n\n```".length;
  const maxContentLength = Math.max(1, MAX_SLACK_SECTION_TEXT_LENGTH - fenceOverhead);
  const chunks = codeText.length > 0 ? splitSlackTextByLength(codeText, maxContentLength) : [""];
  return chunks.map((chunk) => {
    const normalizedChunk = trimTrailingNewline(chunk);
    const fenced = `\`\`\`\n${normalizedChunk}\n\`\`\``;
    return {
      type: "section",
      text: { type: "mrkdwn", text: fenced },
      expand: true,
    };
  });
};

const formatHeadingText = (level: number, text: string): string => {
  if (level === 2) {
    return `*<${text}>*`;
  }
  if (level === 3) {
    return `*[${text}]*`;
  }
  if (level === 4) {
    return `*${text}*`;
  }
  return text;
};

const buildHeadingBlocks = (level: number, text: string): SlackMessageBlock[] => {
  const normalized = normalizeSlackMrkdwn(text.trim());
  if (normalized.length === 0) {
    return [];
  }

  if (level === 1) {
    const plain = stripSlackMrkdwn(normalized);
    const headerText = truncatePlainText(plain, MAX_SLACK_HEADER_TEXT_LENGTH);
    if (headerText.length === 0) {
      return [];
    }
    return [
      {
        type: "header",
        text: { type: "plain_text", text: headerText },
      },
    ];
  }

  const formatted = formatHeadingText(level, normalized);
  return buildSectionBlocks(formatted);
};

const buildSlackBlocksFromMarkdown = (text: string): SlackMessageBlock[] => {
  const blocks: SlackMessageBlock[] = [];
  const lines = text.split("\n");
  let paragraphLines: string[] = [];
  let codeLines: string[] = [];
  let inCodeBlock = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const paragraphText = paragraphLines.join("\n").trimEnd();
    paragraphLines = [];
    const normalized = normalizeSlackMrkdwn(paragraphText);
    if (normalized.length === 0) {
      return;
    }
    blocks.push(...buildSectionBlocks(normalized));
  };

  const flushCodeBlock = () => {
    const codeText = codeLines.join("\n");
    codeLines = [];
    blocks.push(...buildCodeSectionBlocks(codeText));
  };

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (inCodeBlock) {
      if (trimmedLine.startsWith("```")) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      flushParagraph();
      inCodeBlock = true;
      codeLines = [];
      continue;
    }

    if (trimmedLine === "---") {
      flushParagraph();
      blocks.push({ type: "divider" });
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      if (headingText.length > 0) {
        blocks.push(...buildHeadingBlocks(level, headingText));
      }
      continue;
    }

    if (trimmedLine.length === 0) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(line);
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  return blocks;
};

const extractSlackBlockText = (block: SlackMessageBlock): string | null => {
  if (!isRecord(block)) {
    return null;
  }
  const text = block.text;
  if (!isRecord(text)) {
    return null;
  }
  return typeof text.text === "string" ? text.text : null;
};

const buildSlackFallbackText = (blocks: SlackMessageBlock[]): string => {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = extractSlackBlockText(block);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join("\n");
};

const splitSlackBlocksIntoMessages = (blocks: SlackMessageBlock[]): SlackMessageBlock[][] => {
  if (blocks.length === 0) {
    return [];
  }

  const segments: SlackMessageBlock[][] = [];
  let current: SlackMessageBlock[] = [];
  let currentLength = 0;

  for (const block of blocks) {
    const blockText = extractSlackBlockText(block);
    const blockLength = blockText?.length ?? 0;
    const separator = current.length > 0 ? 1 : 0;
    const nextLength = currentLength + separator + blockLength;

    if (
      current.length > 0 &&
      (nextLength > MAX_SLACK_MESSAGE_TEXT_LENGTH || current.length + 1 > MAX_SLACK_MESSAGE_BLOCKS)
    ) {
      segments.push(current);
      current = [];
      currentLength = 0;
    }

    const nextSeparator = current.length > 0 ? 1 : 0;
    current.push(block);
    currentLength += nextSeparator + blockLength;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
};

type SlackSegmentState = {
  ts: string;
  blocks: SlackMessageBlock[];
  signature: string;
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
      const desiredSegments = this.buildSlackMessageSegments(text, includeThinking);

      if (desiredSegments.length === 0) {
        return false;
      }

      for (let index = this.segmentStates.length; index < desiredSegments.length; index += 1) {
        const segmentBlocks = desiredSegments[index];
        const payload = this.buildSlackMessagePayload(segmentBlocks, {
          includeThinking: includeThinking && segmentBlocks.length === 0,
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
          blocks: segmentBlocks,
          signature: this.serializePayload(payload),
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
        const nextBlocks = index < desiredSegments.length ? desiredSegments[index] : state.blocks;
        const nextIncludeThinking = includeThinking && index === lastOutputIndex;

        const payload = this.buildSlackMessagePayload(nextBlocks, { includeThinking: nextIncludeThinking });
        if (!payload) {
          continue;
        }

        const signature = this.serializePayload(payload);
        if (signature === state.signature) {
          if (index < desiredSegments.length) {
            state.blocks = nextBlocks;
          }
          if (index === lastOutputIndex) {
            updatedLast = true;
          }
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

        state.signature = signature;
        if (index < desiredSegments.length) {
          state.blocks = nextBlocks;
        }
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

  private buildSlackMessagePayload(blocks: SlackMessageBlock[], options: { includeThinking: boolean }): SlackMessagePayload | null {
    const messageBlocks = [...blocks];
    if (options.includeThinking) {
      messageBlocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: THINKING_CONTEXT_TEXT }],
      });
    }

    if (messageBlocks.length === 0) {
      return null;
    }

    const fallbackText = buildSlackFallbackText(blocks);
    return { text: fallbackText.length > 0 ? fallbackText : THINKING_CONTEXT_TEXT, blocks: messageBlocks };
  }

  private buildSlackMessageSegments(text: string, includeThinking: boolean): SlackMessageBlock[][] {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return includeThinking ? [[]] : [];
    }

    const blocks = buildSlackBlocksFromMarkdown(trimmed);
    if (blocks.length === 0) {
      return includeThinking ? [[]] : [];
    }

    return splitSlackBlocksIntoMessages(blocks);
  }

  private serializePayload(payload: SlackMessagePayload): string {
    return JSON.stringify(payload.blocks);
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
