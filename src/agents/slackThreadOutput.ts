import type { KnownBlock } from "@slack/web-api";

import { getAgentSubject } from "../agentConfig.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isRecord } from "../utils/object.ts";
import type { SlackContext } from "./slackContext.ts";

const MAX_SLACK_TEXT_LENGTH = 38_000;

const THINKING_CONTEXT_TEXT = `:loading-dots: ${getAgentSubject()} 생각 중이에요`;

type SlackMessageBlock = KnownBlock;

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
    const normalized = hasText ? trimSlackText(trimmed) : "";
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
