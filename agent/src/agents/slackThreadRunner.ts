import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getAgentMcpServers, type McpServerEntry } from "../agentConfig.ts";
import { CONFIG } from "../config.ts";
import { createSenaObsidianMcpServer } from "../mcp/obsidianMcp.ts";
import { createSenaSlackMcpServer } from "../mcp/slackMcp.ts";
import { getCouchDBClient } from "../sdks/couchdb.ts";
import { sanitizeEnv } from "../utils/env.ts";
import { createAgentRuntimeStream, type AgentRuntimeEvent, type AgentRuntimeUserMessage } from "./agentRuntime.ts";
import { buildBootstrapPrompt, buildFollowupPrompt, buildSystemPromptAppend } from "./slackPrompts.ts";
import type { SlackContext } from "./slackContext.ts";
import { SlackThreadOutput } from "./slackThreadOutput.ts";
import { SlackThreadProgress } from "./slackThreadProgress.ts";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
const DEFAULT_CODEX_MODEL = "gpt-5-codex";
const CODEX_MCP_SERVER_ARG = "--mcp-server";

const SLACK_PROGRESS_THROTTLE_MS = 3000;
const THREAD_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

type TurnState = "idle" | "active" | "finalizing";

type ToolProgress = { toolUseId: string; toolName: string };
type ToolResult = { toolUseId: string; isError: boolean };
type ToolUse = { id: string; name: string };

const BRIDGE_EXEC_ARGV_BLOCKLIST = [/^--inspect(?:-brk)?(?:=.*)?$/u, /^--watch(?:=.*)?$/u];

const filterBridgeExecArgv = (argv: string[]): string[] =>
  argv.filter((arg) => !BRIDGE_EXEC_ARGV_BLOCKLIST.some((pattern) => pattern.test(arg)));

const resolveWorkerEntrypointForBridge = (): string => {
  const envEntrypoint = CONFIG.WORKER_ENTRYPOINT.trim();
  if (envEntrypoint.length > 0) {
    return path.isAbsolute(envEntrypoint) ? envEntrypoint : path.resolve(process.cwd(), envEntrypoint);
  }

  const argvEntrypoint = process.argv[1]?.trim() ?? "";
  if (argvEntrypoint.length > 0) {
    return path.isAbsolute(argvEntrypoint) ? argvEntrypoint : path.resolve(process.cwd(), argvEntrypoint);
  }

  return path.join(process.cwd(), "dist/worker/index.js");
};

const resolveCodexBridgeEntrypoint = (): { command: string; args: string[] } => {
  const resolvedEntrypoint = resolveWorkerEntrypointForBridge();
  return {
    command: process.execPath,
    args: [...filterBridgeExecArgv(process.execArgv), resolvedEntrypoint],
  };
};

class AsyncUserMessageQueue implements AsyncIterable<AgentRuntimeUserMessage> {
  private closed = false;
  private queue: AgentRuntimeUserMessage[] = [];
  private waiting: Array<(result: IteratorResult<AgentRuntimeUserMessage, void>) => void> = [];

  push(value: AgentRuntimeUserMessage): boolean {
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

  [Symbol.asyncIterator](): AsyncIterator<AgentRuntimeUserMessage, void, void> {
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
    this.slack.slackUserName = next.slackUserName;
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
      this.toRuntimeUserMessage(prompt, { isSynthetic: options?.isSynthetic ?? false }),
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

  private toRuntimeUserMessage(text: string, options: { isSynthetic: boolean }): AgentRuntimeUserMessage {
    return {
      text,
      isSynthetic: options.isSynthetic,
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

  private resolveModel(): string {
    const configured = CONFIG.AGENT_MODEL.trim();
    if (configured.length > 0) {
      return configured;
    }
    return CONFIG.AGENT_RUNTIME_MODE === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_CLAUDE_MODEL;
  }

  private buildCodexBuiltinMcpServers(options: { includeObsidian: boolean }): Record<string, McpServerEntry> {
    const bridge = resolveCodexBridgeEntrypoint();
    const slack: McpServerEntry = {
      command: bridge.command,
      args: [...bridge.args, CODEX_MCP_SERVER_ARG, "slack"],
    };

    if (!options.includeObsidian) {
      return { slack };
    }

    const obsidian: McpServerEntry = {
      command: bridge.command,
      args: [...bridge.args, CODEX_MCP_SERVER_ARG, "obsidian"],
    };
    return { slack, obsidian };
  }

  private async handleRuntimeEvent(event: AgentRuntimeEvent): Promise<void> {
    if (event.type === "session.init") {
      this.sessionId = event.sessionId;
      this.onSessionId(event.sessionId);
      return;
    }

    if (event.type === "assistant.stream.start") {
      this.progress.resetStreamingAssistantBuffer();
      return;
    }

    if (event.type === "tool.progress") {
      this.handleToolProgress({ toolUseId: event.toolUseId, toolName: event.toolName });
      return;
    }

    if (event.type === "tool.result") {
      this.handleToolResults([{ toolUseId: event.toolUseId, isError: event.isError }]);
      return;
    }

    if (event.type === "assistant.delta") {
      this.handleAssistantDelta(event.text);
      return;
    }

    if (event.type === "assistant.text") {
      this.handleAssistantText(event.text);
      return;
    }

    if (event.type === "tool.use") {
      this.handleToolUses([{ id: event.toolUseId, name: event.toolName }]);
      return;
    }

    if (event.type === "result") {
      await this.handleResultText(event.text);
    }
  }

  private async runLoop(): Promise<void> {
    await fs.mkdir(CONFIG.CWD, { recursive: true });

    const env = {
      ...sanitizeEnv(process.env),
    };
    const model = this.resolveModel();
    const couchdbClient = getCouchDBClient();
    const systemPromptAppend = await buildSystemPromptAppend();

    const stream =
      CONFIG.AGENT_RUNTIME_MODE === "codex"
        ? createAgentRuntimeStream({
            mode: "codex",
            prompt: this.promptQueue,
            resumeSessionId: this.resumeSessionId,
            model,
            cwd: CONFIG.CWD,
            env,
            abortController: this.abortController,
            apiKey: CONFIG.CODEX_API_KEY,
            baseUrl: CONFIG.OPENAI_BASE_URL,
            systemPromptAppend,
            mcpServers: {
              ...getAgentMcpServers(),
              ...this.buildCodexBuiltinMcpServers({ includeObsidian: Boolean(couchdbClient) }),
            },
          })
        : createAgentRuntimeStream({
            mode: "claude",
            prompt: this.promptQueue,
            resumeSessionId: this.resumeSessionId,
            model,
            cwd: CONFIG.CWD,
            env,
            abortController: this.abortController,
            systemPromptAppend,
            settingSources: ["user", "project", "local"],
            mcpServers: {
              ...getAgentMcpServers(),
              slack: createSenaSlackMcpServer({
                slack: this.slack,
                getSessionId: () => this.sessionId,
              }),
              ...(couchdbClient ? { obsidian: createSenaObsidianMcpServer(couchdbClient) } : {}),
              context7: { type: "http", url: "https://mcp.context7.com/mcp" },
            },
          });

    try {
      for await (const event of stream) {
        await this.handleRuntimeEvent(event);
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
