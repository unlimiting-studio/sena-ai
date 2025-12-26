import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import * as fs from "node:fs/promises";

import { CONFIG } from "../config.ts";
import { createSenaHitlMcpServer } from "../mcp/hitlMcp.ts";
import { createSenaSlackMcpServer } from "../mcp/slackMcp.ts";
import { sanitizeEnv } from "../utils/env.ts";
import { buildBootstrapPrompt, buildFollowupPrompt, SYSTEM_PROMPT_APPEND } from "./slackPrompts.ts";
import {
  extractAssistantText,
  extractResultText,
  extractSessionId,
  extractStreamDeltaText,
  extractToolProgress,
  extractToolResults,
  extractToolUses,
  type ToolProgress,
  type ToolResult,
  type ToolUse,
} from "./slackStreamParser.ts";
import type { SlackContext } from "./slackContext.ts";
import { SlackThreadOutput } from "./slackThreadOutput.ts";
import { SlackThreadProgress } from "./slackThreadProgress.ts";

const DEFAULT_MODEL = "claude-sonnet-4-5";

const SLACK_PROGRESS_THROTTLE_MS = 500;
const THREAD_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

type TurnState = "idle" | "active" | "finalizing";

class AsyncUserMessageQueue implements AsyncIterable<SDKUserMessage> {
  private closed = false;
  private queue: SDKUserMessage[] = [];
  private waiting: Array<(result: IteratorResult<SDKUserMessage, void>) => void> = [];

  push(value: SDKUserMessage): boolean {
    if (this.closed) {
      return false;
    }

    const resolver = this.waiting.shift();
    if (resolver) {
      resolver({ value, done: false });
      return true;
    }

    this.queue.push(value);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const resolver of this.waiting) {
      resolver({ value: undefined, done: true });
    }
    this.waiting = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void, void> {
    return {
      next: () => {
        const value = this.queue.shift();
        if (value) {
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

type ThreadRunnerOptions = {
  initialSlack: SlackContext;
  resumeSessionId: string | null;
  onSessionId: (sessionId: string) => void;
  onStop: () => void;
};

export class SlackThreadRunner {
  private slack: SlackContext;
  private output: SlackThreadOutput;
  private progress = new SlackThreadProgress();

  private promptQueue = new AsyncUserMessageQueue();
  private abortController = new AbortController();
  private started = false;
  private ended = false;

  private resumeSessionId: string | null;
  private sessionId: string | null;
  private onSessionId: (sessionId: string) => void;
  private onStop: () => void;

  private turnState: TurnState = "idle";
  private pendingTurns = 0;

  private lastProgressUpdateAt = 0;
  private lastProgressText: string | null = null;
  private pendingProgressTimer: NodeJS.Timeout | null = null;
  private pendingForceProgress = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private stopReason: "idle" | "restart" | "manual" | null = null;

  private hasPrompted = false;

  constructor(options: ThreadRunnerOptions) {
    this.slack = { ...options.initialSlack };
    this.output = new SlackThreadOutput(this.slack);
    this.resumeSessionId = options.resumeSessionId;
    this.sessionId = options.resumeSessionId;
    this.onSessionId = options.onSessionId;
    this.onStop = options.onStop;
  }

  updateSlackContext(next: SlackContext): void {
    this.slack.teamId = next.teamId;
    this.slack.channelId = next.channelId;
    this.slack.threadTs = next.threadTs;
    this.slack.messageTs = next.messageTs;
    this.slack.slackUserId = next.slackUserId;
    this.output.updateSlackContext(this.slack);
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.runLoop()
      .catch((error) => {
        if (this.stopReason) {
          return;
        }
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        this.progress.setError(message);
        this.queueProgressUpdate(true);
      })
      .finally(() => {
        this.ended = true;
        this.promptQueue.close();
        this.onStop();
      });
  }

  stop(options?: { reason?: "idle" | "restart" | "manual"; abort?: boolean }): void {
    this.stopReason = options?.reason ?? this.stopReason ?? "manual";
    this.promptQueue.close();
    if (options?.abort) {
      this.abortController.abort("runner_stopped");
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.clearProgressTimer();
  }

  enqueueUserInput(text: string, options?: { isSynthetic?: boolean }): boolean {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return false;
    }

    if (!this.canAcceptInput()) {
      return false;
    }

    this.bumpIdleTimer();
    this.pendingTurns += 1;
    this.startNextTurn();

    const prompt = this.hasPrompted
      ? buildFollowupPrompt(this.slack, normalized)
      : buildBootstrapPrompt(this.slack, normalized);

    this.hasPrompted = true;
    const enqueued = this.promptQueue.push(
      this.toSdkUserMessage(prompt, { isSynthetic: options?.isSynthetic ?? false }),
    );
    if (!enqueued) {
      return false;
    }

    if (!this.started) {
      this.start();
    }

    return true;
  }

  canAcceptInput(): boolean {
    return !this.ended && this.stopReason === null;
  }

  private toSdkUserMessage(text: string, options: { isSynthetic: boolean }): SDKUserMessage {
    return {
      type: "user",
      session_id: this.sessionId ?? "",
      parent_tool_use_id: null,
      ...(options.isSynthetic ? { isSynthetic: true } : {}),
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    };
  }

  private bumpIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.stop({ reason: "idle", abort: false });
    }, THREAD_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  private startNextTurn(): void {
    if (this.turnState !== "idle" || this.pendingTurns === 0) {
      return;
    }

    this.pendingTurns -= 1;
    this.turnState = "active";
    this.output.resetForTurn();
    this.resetProgressState();
    void this.showThinkingIndicator().catch(() => undefined);
  }

  private async showThinkingIndicator(): Promise<void> {
    const updated = await this.output.showThinkingIndicator();
    if (updated) {
      this.lastProgressText = "";
      this.lastProgressUpdateAt = Date.now();
    }
  }

  private resetProgressState(): void {
    this.progress.resetForTurn();
    this.lastProgressText = null;
    this.lastProgressUpdateAt = 0;
    this.clearProgressTimer();
  }

  private finishTurn(): void {
    this.turnState = "idle";
    this.progress.clearAfterTurn();
    this.output.resetForTurn();
    this.lastProgressText = null;
    this.lastProgressUpdateAt = 0;
    this.clearProgressTimer();
    if (this.pendingTurns > 0) {
      this.startNextTurn();
    }
  }

  private clearProgressTimer(): void {
    if (this.pendingProgressTimer) {
      clearTimeout(this.pendingProgressTimer);
      this.pendingProgressTimer = null;
      this.pendingForceProgress = false;
    }
  }

  private async finalizeTurn(text: string): Promise<void> {
    this.turnState = "finalizing";
    this.clearProgressTimer();
    const normalized = text.trim();
    if (normalized.length === 0) {
      if (!this.progress.isAwaitingUserAction()) {
        await this.finalizeError("완료했지만 출력이 비어있어요. 다시 시도해 주세요.");
        return;
      }
      this.finishTurn();
      return;
    }

    const updated = await this.output.update(normalized, { includeThinking: false });
    if (updated) {
      this.lastProgressText = normalized;
      this.lastProgressUpdateAt = Date.now();
    }

    this.finishTurn();
  }

  private async finalizeError(message: string): Promise<void> {
    this.turnState = "finalizing";
    this.clearProgressTimer();
    const normalized = message.trim();
    const text = normalized.length > 0 ? `⚠️ ${normalized}` : "⚠️ 알 수 없는 오류";
    const updated = await this.output.update(text, { includeThinking: false });
    if (updated) {
      this.lastProgressText = text;
      this.lastProgressUpdateAt = Date.now();
    }
    this.finishTurn();
  }

  private queueProgressUpdate(force: boolean): void {
    if (this.turnState !== "active") {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastProgressUpdateAt;
    if (force || elapsed >= SLACK_PROGRESS_THROTTLE_MS) {
      void this.flushProgressUpdate(force).catch(() => undefined);
      return;
    }

    this.pendingForceProgress = this.pendingForceProgress || force;
    if (this.pendingProgressTimer) {
      return;
    }

    const delay = SLACK_PROGRESS_THROTTLE_MS - elapsed;
    this.pendingProgressTimer = setTimeout(() => {
      this.pendingProgressTimer = null;
      const useForce = this.pendingForceProgress;
      this.pendingForceProgress = false;
      void this.flushProgressUpdate(useForce).catch(() => undefined);
    }, delay);
    this.pendingProgressTimer.unref?.();
  }

  private async flushProgressUpdate(force: boolean): Promise<void> {
    if (this.turnState !== "active") {
      return;
    }
    const text = this.progress.renderProgressMessage();
    if (!text) {
      return;
    }

    if (!force && text === this.lastProgressText) {
      return;
    }

    const updated = await this.output.update(text, { includeThinking: this.turnState === "active" });
    if (!updated) {
      return;
    }

    this.lastProgressText = text;
    this.lastProgressUpdateAt = Date.now();
  }

  private shouldForceProgressUpdate(): boolean {
    return this.output.getOutputMessageTs() === null || this.lastProgressText === "";
  }

  private handleToolProgress(progress: ToolProgress): void {
    if (this.progress.registerToolCall({ id: progress.toolUseId, name: progress.toolName })) {
      this.queueProgressUpdate(false);
    }
  }

  private handleToolResults(results: ToolResult[]): void {
    let changed = false;
    for (const result of results) {
      if (this.progress.completeToolCall({ toolUseId: result.toolUseId, isError: result.isError })) {
        changed = true;
      }
    }
    if (changed) {
      this.queueProgressUpdate(false);
    }
  }

  private handleToolUses(uses: ToolUse[]): void {
    let changed = false;
    for (const toolUse of uses) {
      if (this.progress.registerToolCall({ id: toolUse.id, name: toolUse.name })) {
        changed = true;
      }
    }
    if (changed) {
      this.queueProgressUpdate(false);
    }
  }

  private handleAssistantDelta(delta: string): void {
    if (this.progress.appendAssistantDelta(delta)) {
      this.queueProgressUpdate(this.shouldForceProgressUpdate());
    }
  }

  private handleAssistantText(text: string): void {
    if (this.progress.noteAssistantText(text)) {
      this.queueProgressUpdate(this.shouldForceProgressUpdate());
    }
  }

  private async handleResultText(text: string): Promise<void> {
    this.progress.setFinalAnswer(text);
    await this.finalizeTurn(text);
  }

  private async runLoop(): Promise<void> {
    await fs.mkdir(CONFIG.WORKSPACE_DIR, { recursive: true });

    const env = {
      ...sanitizeEnv(process.env),
    };

    const slackMcp = createSenaSlackMcpServer({
      slack: this.slack,
      getSessionId: () => this.sessionId,
    });

    const hitlMcp = createSenaHitlMcpServer({
      slack: this.slack,
      getSessionId: () => this.sessionId,
    });

    const stream = query({
      prompt: this.promptQueue,
      options: {
        model: DEFAULT_MODEL,
        cwd: CONFIG.WORKSPACE_DIR,
        includePartialMessages: true,
        permissionMode: "bypassPermissions",
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_PROMPT_APPEND },
        settingSources: ["user", "project", "local"],
        abortController: this.abortController,
        ...(this.resumeSessionId ? { resume: this.resumeSessionId } : {}),
        mcpServers: {
          "sena-slack": slackMcp,
          "sena-auth": hitlMcp,
          context7: { type: "http", url: "https://mcp.context7.com/mcp" },
        },
        env,
      },
    });

    try {
      for await (const message of stream) {
        const sessionId = extractSessionId(message);
        if (sessionId) {
          this.sessionId = sessionId;
          this.onSessionId(sessionId);
        }

        const toolProgress = extractToolProgress(message);
        if (toolProgress) {
          this.handleToolProgress(toolProgress);
          continue;
        }

        let shouldContinue = false;

        const toolResults = extractToolResults(message);
        if (toolResults.length > 0) {
          this.handleToolResults(toolResults);
          shouldContinue = true;
        }

        const streamDelta = extractStreamDeltaText(message);
        if (streamDelta) {
          this.handleAssistantDelta(streamDelta);
          shouldContinue = true;
        }

        const assistantText = extractAssistantText(message);
        if (assistantText) {
          this.handleAssistantText(assistantText);
          shouldContinue = true;
        }

        const toolUses = extractToolUses(message);
        if (toolUses.length > 0) {
          this.handleToolUses(toolUses);
          shouldContinue = true;
        }

        if (shouldContinue) {
          continue;
        }

        const resultText = extractResultText(message);
        if (resultText) {
          await this.handleResultText(resultText);
        }
      }
    } catch (error) {
      if (this.stopReason) {
        return;
      }
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      await this.finalizeError(message);
      return;
    }

    if (this.stopReason) {
      return;
    }

    if (this.turnState === "active") {
      const fallback = this.progress.getFinalAnswer()?.trim() || this.progress.getLastAssistantText();
      if (fallback) {
        await this.finalizeTurn(fallback);
        return;
      }

      if (this.progress.isAwaitingUserAction()) {
        this.finishTurn();
        return;
      }

      await this.finalizeError("완료했지만 출력이 비어있어요. 다시 시도해 주세요.");
    }
  }
}
