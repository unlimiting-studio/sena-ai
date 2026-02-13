import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  Codex,
  type ThreadItem,
  type ThreadOptions as CodexThreadOptions,
  type TurnOptions as CodexTurnOptions,
} from "@openai/codex-sdk";

import type { McpServerEntry } from "../agentConfig.ts";
import {
  extractAssistantText,
  extractResultText,
  extractSessionId,
  extractStreamDeltaText,
  extractToolProgress,
  extractToolResults,
  extractToolUses,
  isAssistantStreamMessageStart,
} from "./slackStreamParser.ts";

type ClaudeQueryOptions = NonNullable<Parameters<typeof query>[0]["options"]>;
type ClaudeMcpServers = NonNullable<ClaudeQueryOptions["mcpServers"]>;

type CodexMcpServerConfig =
  | {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      url: string;
      http_headers?: Record<string, string>;
    };

export type AgentRuntimeMode = "claude" | "codex";

export type AgentRuntimeUserMessage = {
  text: string;
  isSynthetic: boolean;
};

export type AgentRuntimeEvent =
  | { type: "session.init"; sessionId: string }
  | { type: "assistant.stream.start" }
  | { type: "assistant.delta"; text: string }
  | { type: "assistant.text"; text: string }
  | { type: "tool.use"; toolUseId: string; toolName: string }
  | { type: "tool.progress"; toolUseId: string; toolName: string }
  | { type: "tool.result"; toolUseId: string; isError: boolean }
  | { type: "result"; text: string };

type BaseRuntimeOptions = {
  prompt: AsyncIterable<AgentRuntimeUserMessage>;
  resumeSessionId: string | null;
  model: string;
  cwd: string;
  env: Record<string, string>;
  abortController: AbortController;
};

type ClaudeRuntimeOptions = BaseRuntimeOptions & {
  mode: "claude";
  systemPromptAppend: string;
  settingSources: NonNullable<ClaudeQueryOptions["settingSources"]>;
  mcpServers: ClaudeMcpServers;
};

type CodexRuntimeOptions = BaseRuntimeOptions & {
  mode: "codex";
  apiKey: string;
  baseUrl: string;
  systemPromptAppend: string;
  mcpServers: Record<string, McpServerEntry>;
};

export type AgentRuntimeOptions = ClaudeRuntimeOptions | CodexRuntimeOptions;

const normalizeNonEmptyTrimmed = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const buildSessionInitEvent = (
  rawSessionId: string | null | undefined,
  state: { emittedSessionId: string | null },
): AgentRuntimeEvent | null => {
  const sessionId = normalizeNonEmptyTrimmed(rawSessionId);
  if (!sessionId) {
    return null;
  }
  if (state.emittedSessionId === sessionId) {
    return null;
  }
  state.emittedSessionId = sessionId;
  return { type: "session.init", sessionId };
};

const toClaudePrompt = async function* (
  prompt: AsyncIterable<AgentRuntimeUserMessage>,
  getSessionId: () => string,
): AsyncGenerator<SDKUserMessage> {
  for await (const message of prompt) {
    yield {
      type: "user",
      session_id: getSessionId(),
      parent_tool_use_id: null,
      ...(message.isSynthetic ? { isSynthetic: true } : {}),
      message: {
        role: "user",
        content: [{ type: "text", text: message.text }],
      },
    };
  }
};

const runClaudeRuntime = async function* (options: ClaudeRuntimeOptions): AsyncGenerator<AgentRuntimeEvent> {
  const resumeSessionId = normalizeNonEmptyTrimmed(options.resumeSessionId);
  const sessionState = { emittedSessionId: resumeSessionId };
  let currentSessionId = sessionState.emittedSessionId ?? "";
  if (sessionState.emittedSessionId) {
    yield { type: "session.init", sessionId: sessionState.emittedSessionId };
  }

  const stream = query({
    prompt: toClaudePrompt(options.prompt, () => currentSessionId),
    options: {
      model: options.model,
      cwd: options.cwd,
      includePartialMessages: true,
      permissionMode: "bypassPermissions",
      systemPrompt: { type: "preset", preset: "claude_code", append: options.systemPromptAppend },
      settingSources: options.settingSources,
      abortController: options.abortController,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      mcpServers: options.mcpServers,
      env: options.env,
    },
  });

  for await (const message of stream) {
    const sessionId = extractSessionId(message);
    if (sessionId) {
      currentSessionId = sessionId;
      const sessionEvent = buildSessionInitEvent(sessionId, sessionState);
      if (sessionEvent) {
        yield sessionEvent;
      }
    }

    if (isAssistantStreamMessageStart(message)) {
      yield { type: "assistant.stream.start" };
      continue;
    }

    const toolProgress = extractToolProgress(message);
    if (toolProgress) {
      yield { type: "tool.progress", toolUseId: toolProgress.toolUseId, toolName: toolProgress.toolName };
      continue;
    }

    const toolResults = extractToolResults(message);
    for (const result of toolResults) {
      yield { type: "tool.result", toolUseId: result.toolUseId, isError: result.isError };
    }

    const streamDelta = extractStreamDeltaText(message);
    if (streamDelta) {
      yield { type: "assistant.delta", text: streamDelta };
    }

    const assistantText = extractAssistantText(message);
    if (assistantText) {
      yield { type: "assistant.text", text: assistantText };
    }

    const toolUses = extractToolUses(message);
    for (const toolUse of toolUses) {
      yield { type: "tool.use", toolUseId: toolUse.id, toolName: toolUse.name };
    }

    const resultText = extractResultText(message);
    if (resultText) {
      yield { type: "result", text: resultText };
    }
  }
};

const buildCodexMcpServerConfig = (entry: McpServerEntry): CodexMcpServerConfig => {
  if ("command" in entry) {
    return {
      command: entry.command,
      ...(entry.args ? { args: entry.args } : {}),
      ...(entry.env ? { env: entry.env } : {}),
    };
  }
  return {
    url: entry.url,
    ...(entry.headers ? { http_headers: entry.headers } : {}),
  };
};

const buildCodexMcpServersConfig = (servers: Record<string, McpServerEntry>): Record<string, CodexMcpServerConfig> => {
  const merged: Record<string, McpServerEntry> = { ...servers };
  if (!merged.context7) {
    merged.context7 = { type: "http", url: "https://mcp.context7.com/mcp" };
  }

  const config: Record<string, CodexMcpServerConfig> = {};
  for (const [name, entry] of Object.entries(merged)) {
    config[name] = buildCodexMcpServerConfig(entry);
  }
  return config;
};

const toToolName = (item: ThreadItem): string | null => {
  if (item.type === "mcp_tool_call") {
    const server = normalizeNonEmptyTrimmed(item.server);
    const tool = normalizeNonEmptyTrimmed(item.tool);
    if (!server || !tool) {
      return null;
    }
    return `mcp__${server}__${tool}`;
  }
  if (item.type === "command_execution") {
    return "bash";
  }
  if (item.type === "web_search") {
    return "web.search";
  }
  return null;
};

type CodexTurnState = {
  assistantByItemId: Map<string, string>;
  lastAssistantText: string | null;
  completedAssistantText: string | null;
  seenToolUseIds: Set<string>;
};

const createCodexTurnState = (): CodexTurnState => ({
  assistantByItemId: new Map<string, string>(),
  lastAssistantText: null,
  completedAssistantText: null,
  seenToolUseIds: new Set<string>(),
});

const mapCodexItemEvent = (
  eventType: "item.started" | "item.updated" | "item.completed",
  item: ThreadItem,
  state: CodexTurnState,
): AgentRuntimeEvent[] => {
  if (item.type === "agent_message") {
    const normalized = normalizeNonEmptyTrimmed(item.text);
    if (!normalized) {
      return [];
    }

    const previous = state.assistantByItemId.get(item.id) ?? "";
    state.assistantByItemId.set(item.id, item.text);
    state.lastAssistantText = normalized;
    if (eventType === "item.completed") {
      state.completedAssistantText = normalized;
    }

    const events: AgentRuntimeEvent[] = [];
    if (previous.length > 0 && item.text.startsWith(previous)) {
      const delta = item.text.slice(previous.length);
      if (delta.length > 0) {
        events.push({ type: "assistant.delta", text: delta });
      }
    }
    events.push({ type: "assistant.text", text: normalized });
    return events;
  }

  const toolUseId = normalizeNonEmptyTrimmed(item.id);
  const toolName = toToolName(item);
  if (!toolUseId || !toolName) {
    return [];
  }

  if (eventType === "item.started") {
    state.seenToolUseIds.add(toolUseId);
    return [{ type: "tool.use", toolUseId, toolName }];
  }

  if (eventType === "item.updated") {
    return [{ type: "tool.progress", toolUseId, toolName }];
  }

  const resultEvents: AgentRuntimeEvent[] = [];
  if (!state.seenToolUseIds.has(toolUseId)) {
    state.seenToolUseIds.add(toolUseId);
    resultEvents.push({ type: "tool.use", toolUseId, toolName });
  }

  if (item.type === "mcp_tool_call") {
    resultEvents.push({ type: "tool.result", toolUseId, isError: item.status !== "completed" });
    return resultEvents;
  }

  if (item.type === "command_execution") {
    const isError = item.status !== "completed" || (typeof item.exit_code === "number" && item.exit_code !== 0);
    resultEvents.push({ type: "tool.result", toolUseId, isError });
    return resultEvents;
  }

  resultEvents.push({ type: "tool.result", toolUseId, isError: false });
  return resultEvents;
};

const runCodexRuntime = async function* (options: CodexRuntimeOptions): AsyncGenerator<AgentRuntimeEvent> {
  const resumeSessionId = normalizeNonEmptyTrimmed(options.resumeSessionId);
  const sessionState = { emittedSessionId: resumeSessionId };
  if (sessionState.emittedSessionId) {
    yield { type: "session.init", sessionId: sessionState.emittedSessionId };
  }

  const codex = new Codex({
    ...(options.baseUrl.trim().length > 0 ? { baseUrl: options.baseUrl } : {}),
    ...(options.apiKey.trim().length > 0 ? { apiKey: options.apiKey } : {}),
    config: {
      instructions: options.systemPromptAppend,
      mcp_servers: buildCodexMcpServersConfig(options.mcpServers),
    },
    env: options.env,
  });

  const threadOptions: CodexThreadOptions = {
    model: options.model,
    workingDirectory: options.cwd,
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    networkAccessEnabled: true,
    modelReasoningEffort: "medium",
  };

  const thread = resumeSessionId ? codex.resumeThread(resumeSessionId, threadOptions) : codex.startThread(threadOptions);

  const startupSessionEvent = buildSessionInitEvent(thread.id, sessionState);
  if (startupSessionEvent) {
    yield startupSessionEvent;
  }

  for await (const message of options.prompt) {
    const input = message.text.trim();
    if (input.length === 0) {
      continue;
    }

    const turnState = createCodexTurnState();
    const turnOptions: CodexTurnOptions = {
      signal: options.abortController.signal,
    };

    const { events } = await thread.runStreamed(input, turnOptions);
    let turnCompleted = false;

    for await (const event of events) {
      const sessionEvent =
        event.type === "thread.started" ? buildSessionInitEvent(event.thread_id, sessionState) : null;
      if (sessionEvent) {
        yield sessionEvent;
      }

      if (event.type === "turn.started") {
        yield { type: "assistant.stream.start" };
        continue;
      }

      if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
        const mappedEvents = mapCodexItemEvent(event.type, event.item, turnState);
        for (const mappedEvent of mappedEvents) {
          yield mappedEvent;
        }
        continue;
      }

      if (event.type === "turn.completed") {
        turnCompleted = true;
        const finalText = turnState.completedAssistantText ?? turnState.lastAssistantText;
        if (finalText) {
          yield { type: "result", text: finalText };
        }
        continue;
      }

      if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      }

      if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    if (!turnCompleted) {
      const fallback = turnState.completedAssistantText ?? turnState.lastAssistantText;
      if (fallback) {
        yield { type: "result", text: fallback };
      }
    }
  }
};

export const createAgentRuntimeStream = (options: AgentRuntimeOptions): AsyncGenerator<AgentRuntimeEvent> => {
  if (options.mode === "claude") {
    return runClaudeRuntime(options);
  }
  return runCodexRuntime(options);
};
