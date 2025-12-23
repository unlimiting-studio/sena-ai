import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getAgentBasePrompt, getAgentSubject } from "../agentConfig.ts";
import { CONFIG } from "../config.ts";
// import { findGithubCredentialBySlackUserId } from "../db/githubCredentials.ts";
import { createSenaHitlMcpServer } from "../mcp/hitlMcp.ts";
import { createSenaSlackMcpServer } from "../mcp/slackMcp.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { sanitizeEnv } from "../utils/env.ts";
import { isRecord } from "../utils/object.ts";
import { SlackThreadSessionStore } from "./threadSessionStore.ts";
import type { KnownBlock } from "@slack/web-api";

export type SlackContext = {
  teamId: string | null;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  slackUserId: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

const MAX_SLACK_TEXT_LENGTH = 38_000;
const SLACK_PROGRESS_THROTTLE_MS = 500;
const THREAD_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const SEOUL_TIME_ZONE = {
  label: "Asia/Seoul (UTC+9)",
  ianaName: "Asia/Seoul",
} as const;

const formatSeoulDateTime = (date: Date): string =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: SEOUL_TIME_ZONE.ianaName,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

const SLACK_MARKDOWN_GUIDANCE =
  "마크다운을 사용 할 때에는 반드시 Slack에서도 동작하는 일반 Markdown만 사용하세요: `**굵게**`, `_기울임_`, `~~취소선~~`, `인라인 코드`, ```코드 블록```, `>` 인용문, `-` 또는 `1.` 목록, `[표시 텍스트](https://example.com)` 링크. `#`, `##` 등의 제목은 지원하지 않습니다. 표 등 확장 Markdown은 지원되지 않으니 리스트로 표현하세요. 불필요한 이스케이프를 피하며, 줄바꿈에 역슬래시를 두 번 써서 이스케이프 하지 마세요.";

const AGENT_BASE_PROMPT = getAgentBasePrompt();
const THINKING_CONTEXT_TEXT = `:loading-dots: ${getAgentSubject()} 생각 중이에요`;

const SYSTEM_PROMPT_APPEND = [
  AGENT_BASE_PROMPT,
  "",
  "[운영 컨텍스트]",
  "- 이 대화는 *Slack 스레드*에서 진행됩니다. 항상 스레드 맥락을 우선으로 파악하고 답하세요.",
  "- 사용자가 준 한 문장만으로 추측하지 말고, 필요하면 먼저 Slack 히스토리를 확인하세요.",
  "- 당신은 사용자와 서로 다른 시스템에서 실행됩니다. 사용자에게 로컬 파일/콘솔을 보라고 하거나, 당신이 만든 파일을 확인하라고 하지 마세요. 필요한 정보는 도구로 수집하고, 결과는 Slack 메시지로 전달하세요.",
  "- OAuth/권한 신청처럼 사용자의 확인이 필요한 단계(HITL)가 있으면, *왜 필요한지*와 *다음 행동*을 짧고 명확하게 안내하세요.",
  "",
  "[사용 가능한 도구]",
  "- Slack 컨텍스트 수집:",
  "  - `mcp__sena-slack__get_messages`: 현재 채널/스레드 메시지를 읽습니다.",
  "  - `mcp__sena-slack__search_messages`: 워크스페이스에서 메시지를 검색합니다. 권한이 없으면 연동 안내가 자동 전송됩니다.",
  "- GitHub 연동(HITL):",
  "  - `mcp__sena-auth__guide_github_integration`: GitHub OAuth 연동이 필요할 때 사용자에게 개인 메시지 안내를 보냅니다.",
  "  - `mcp__sena-auth__guide_repo_permission`: 특정 리포지토리(owner/repo)의 Write 권한이 필요할 때 확인/신청 안내를 보냅니다.",
  "- 라이브러리 문서:",
  "  - `mcp__context7__resolve-library-id` / `mcp__context7__get-library-docs`: 최신 사용법을 확인합니다.",
  "- 또한 Claude Code의 기본 도구(Read/Write/Edit/Bash 등)로 코드베이스를 분석하고 수정할 수 있습니다. 보안/파괴적 작업은 사전 설명 후 최소 범위로 수행하세요.",
  "",
  "[출력/커뮤니케이션 규칙]",
  "- 항상 한국어로 답변합니다.",
  `- ${SLACK_MARKDOWN_GUIDANCE}`,
  "- 다른 사람을 **절대** 멘션 태그(`<@U...>`, `@username`)로 호출하지 마세요. 도구 결과에 멘션 태그가 포함되어도 최종 답변에는 그대로 붙여넣지 말고 제거/치환하세요.",
  "- DM/다자 DM/프라이빗 채널의 이름/내용은 불필요하게 공개하지 말고, 필요한 만큼만 최소 요약하세요.",
  "- channelId/userId/ts 같은 ID는 사용자가 명시적으로 요청하지 않는 한 최종 답변에 노출하지 마세요.",
  "- Slack 메시지 길이 제한이 있으니, 긴 코드/로그는 핵심만 인용하고 나머지는 요약 + 다음 단계로 안내하세요.",
  "- 토큰/쿠키/비밀키 등 민감 정보는 절대 그대로 출력하지 말고, 필요 시 마스킹 처리하세요.",
  "",
  "[소통 지침(개발자/비개발자)]",
  "- 사용자가 개발자라면: 파일/함수/컴포넌트명을 명확히 언급하고, 변경 근거와 적용 방법을 구체적으로 설명하세요.",
  "- 사용자가 비개발자라면: 구현 디테일보다 목적/영향/다음 행동 위주로 쉽게 풀어 설명하고, 파일명/용어는 최소화하세요.",
  "- 코드/식별자(camelCase/snake_case 등)의 대소문자/철자는 정확히 유지하세요.",
  "",
  "[작업 방식]",
  "1) 목표/제약/성공 조건을 1~2문장으로 재확인합니다.",
  "2) 정보가 부족하면 질문을 1~3개로 최소화합니다.",
  "3) 필요하면 Slack 히스토리/문서를 도구로 조회한 뒤 답합니다.",
  "4) 코딩 작업이라면: 변경 계획 → 변경 내용(파일/핵심 diff) → 검증 방법 순서로 제시합니다.",
  "5) 진행 상태는 메시지 하단 컨텍스트로 표시되므로, 최종 답변은 결과/요청사항 위주로 간결하게 정리합니다.",
].join("\n");

type ProgressPhase = "idle" | "acknowledged" | "working" | "drafting" | "waiting" | "completed" | "error";

type ToolMeta = {
  userActionHint?: string;
};

const TOOL_RULES: ReadonlyArray<{
  pattern: RegExp;
  userActionHint?: string;
}> = [
  {
    pattern: /^mcp__sena-auth__guide_github_integration$/u,
    userActionHint: "GitHub 계정 연동",
  },
  {
    pattern: /^mcp__sena-auth__guide_repo_permission$/u,
    userActionHint: "GitHub 리포지토리 권한 승인",
  },
  {
    pattern: /^mcp__sena-slack__search_messages$/u,
  },
  {
    pattern: /^mcp__sena-slack__get_messages$/u,
  },
  {
    pattern: /^mcp__context7__/u,
  },
  {
    pattern: /^(bash|shell_command)$/iu,
  },
  {
    pattern: /read_file|file_read|open_file|file_open|view_file|read\b/iu,
  },
  {
    pattern: /list_files|list_directory|directory_list|list\b/iu,
  },
  {
    pattern: /search|rg|ripgrep|grep/iu,
  },
  {
    pattern: /apply_patch|edit|write|update/iu,
  },
  {
    pattern: /test|lint|check|typecheck|build/iu,
  },
];

const resolveToolMeta = (toolName: string): ToolMeta => {
  const normalized = toolName.trim();
  if (normalized.length === 0) {
    return {};
  }

  for (const rule of TOOL_RULES) {
    if (rule.pattern.test(normalized)) {
      return { userActionHint: rule.userActionHint };
    }
  }

  return {};
};

const trimSlackText = (text: string): string => {
  if (text.length <= MAX_SLACK_TEXT_LENGTH) {
    return text;
  }
  return `...(truncated)\n\n${text.slice(text.length - MAX_SLACK_TEXT_LENGTH)}`;
};

const extractSessionId = (message: SDKMessage): string | null => {
  if (message.type !== "system" || message.subtype !== "init") {
    return null;
  }

  const sessionId = message.session_id.trim();
  return sessionId.length > 0 ? sessionId : null;
};

const extractResultText = (message: SDKMessage): string | null => {
  if (message.type !== "result") {
    return null;
  }

  if (message.subtype !== "success") {
    return null;
  }

  const trimmed = message.result.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractAssistantText = (message: SDKMessage): string | null => {
  if (message.type !== "assistant") {
    return null;
  }

  const parts: string[] = [];
  for (const block of message.message.content) {
    if (block.type !== "text") {
      continue;
    }

    const text = block.text.trim();
    if (text.length > 0) {
      parts.push(text);
    }
  }

  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : null;
};

const extractStreamDeltaText = (message: SDKMessage): string | null => {
  if (message.type !== "stream_event") {
    return null;
  }

  if (message.event.type !== "content_block_delta") {
    return null;
  }

  if (message.event.delta.type !== "text_delta") {
    return null;
  }

  const text = message.event.delta.text;
  return text.length > 0 ? text : null;
};

type ToolCallStatus = "running" | "success" | "error";

type ToolCallEntry = {
  id: string;
  name: string;
  status: ToolCallStatus;
  startedAt: number;
  endedAt: number | null;
};

const logToolCall = (payload: {
  phase: "start" | "complete";
  id: string;
  name: string;
  status: ToolCallStatus;
  durationMs?: number;
}): void => {
  console.info("[tool]", payload);
};

type SlackMessageBlock = KnownBlock;

type SlackMessagePayload = {
  text: string;
  blocks: SlackMessageBlock[];
};

const extractToolUses = (message: SDKMessage): Array<{ id: string; name: string }> => {
  if (message.type !== "assistant") {
    return [];
  }

  const toolUses: Array<{ id: string; name: string }> = [];
  for (const block of message.message.content) {
    if (block.type === "tool_use") {
      const id = block.id.trim();
      const name = block.name.trim();
      if (id.length > 0 && name.length > 0) {
        toolUses.push({ id, name });
      }
      continue;
    }

    if (block.type === "mcp_tool_use") {
      const id = block.id.trim();
      const serverName = block.server_name.trim();
      const toolName = block.name.trim();
      if (id.length > 0 && serverName.length > 0 && toolName.length > 0) {
        toolUses.push({ id, name: `mcp__${serverName}__${toolName}` });
      }
    }
  }

  return toolUses;
};

const extractToolProgress = (message: SDKMessage): { toolUseId: string; toolName: string } | null => {
  if (message.type !== "tool_progress") {
    return null;
  }

  const toolUseId = message.tool_use_id.trim();
  const toolName = message.tool_name.trim();
  if (toolUseId.length === 0 || toolName.length === 0) {
    return null;
  }

  return { toolUseId, toolName };
};

const extractToolResults = (message: SDKMessage): Array<{ toolUseId: string; isError: boolean }> => {
  const results: Array<{ toolUseId: string; isError: boolean }> = [];

  if (message.type === "user") {
    const content = message.message.content;
    if (typeof content !== "string") {
      for (const block of content) {
        if (block.type !== "tool_result") {
          continue;
        }

        const toolUseId = block.tool_use_id.trim();
        if (toolUseId.length === 0) {
          continue;
        }

        results.push({ toolUseId, isError: block.is_error === true });
      }
    }
    return results;
  }

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type !== "mcp_tool_result") {
        continue;
      }

      const toolUseId = block.tool_use_id.trim();
      if (toolUseId.length === 0) {
        continue;
      }

      results.push({ toolUseId, isError: block.is_error });
    }
  }

  return results;
};

const buildThreadKey = (channelId: string, threadTs: string): string => `${channelId}:${threadTs}`;

const resolveThreadTs = (threadTs: string | null, messageTs: string): string => {
  const normalizedThreadTs = threadTs?.trim() ?? "";
  if (normalizedThreadTs.length > 0) {
    return normalizedThreadTs;
  }
  return messageTs;
};

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

class SlackThreadRunner {
  private slack: SlackContext;
  private promptQueue = new AsyncUserMessageQueue();
  private abortController = new AbortController();
  private started = false;
  private ended = false;

  private resumeSessionId: string | null;
  private sessionId: string | null;
  private onSessionId: (sessionId: string) => void;
  private onStop: () => void;

  private inTurn = false;
  private pendingTurns: Array<{ isSynthetic: boolean }> = [];

  private outputMessageTs: string | null = null;
  private lastEnsureOutputAt = 0;
  private lastProgressUpdateAt = 0;
  private lastProgressText: string | null = null;
  private pendingProgressTimer: NodeJS.Timeout | null = null;
  private pendingForceProgress = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private stopReason: "idle" | "restart" | "manual" | null = null;

  private progressPhase: ProgressPhase = "idle";
  private progressDetail: string | null = null;
  private awaitingUserAction = false;
  private awaitingUserActionHint: string | null = null;
  private hasDraftOutput = false;
  private toolCallsById = new Map<string, ToolCallEntry>();
  private lastAssistantText: string | null = null;
  private streamingAssistantText: string | null = null;
  private finalAnswer: string | null = null;
  private bootstrapped = false;

  constructor(options: ThreadRunnerOptions) {
    this.slack = { ...options.initialSlack };
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
        this.setPhase("error", message, { force: true });
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
    if (this.pendingProgressTimer) {
      clearTimeout(this.pendingProgressTimer);
      this.pendingProgressTimer = null;
      this.pendingForceProgress = false;
    }
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
    this.pendingTurns.push({ isSynthetic: options?.isSynthetic ?? false });
    if (!this.inTurn) {
      this.startNextTurn();
    }

    const prompt = this.bootstrapped ? this.buildFollowupPrompt(normalized) : this.buildBootstrapPrompt(normalized);

    this.bootstrapped = true;
    const enqueued = this.promptQueue.push(
      this.toSdkUserMessage(prompt, { isSynthetic: options?.isSynthetic ?? false })
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

  private buildBootstrapPrompt(userText: string): string {
    const threadTs = this.slack.threadTs ?? "";
    return [
      `현재시각: ${formatSeoulDateTime(new Date())} (${SEOUL_TIME_ZONE.label})`,
      "",
      "새 Slack 멘션이 도착했습니다. 이 스레드에서 사용자의 요청을 처리하세요.",
      "",
      `[Slack Context] teamId=${this.slack.teamId ?? ""}, channelId=${
        this.slack.channelId
      }, threadTs=${threadTs}, messageTs=${this.slack.messageTs}, requesterSlackUserId=${this.slack.slackUserId}`,
      "",
      "[사용자 요청]",
      userText,
    ].join("\n");
  }

  private buildFollowupPrompt(userText: string): string {
    const threadTs = this.slack.threadTs ?? "";
    return [
      `현재시각: ${formatSeoulDateTime(new Date())} (${SEOUL_TIME_ZONE.label})`,
      "",
      "새 Slack 메시지가 도착했습니다. 이전 맥락을 유지한 채로 이어서 처리하세요.",
      "",
      `[Slack Context] teamId=${this.slack.teamId ?? ""}, channelId=${
        this.slack.channelId
      }, threadTs=${threadTs}, messageTs=${this.slack.messageTs}, requesterSlackUserId=${this.slack.slackUserId}`,
      "",
      "[추가 요청]",
      userText,
    ].join("\n");
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

  private async updateSlack(text: string, options?: { includeThinking?: boolean }): Promise<boolean> {
    const includeThinking = options?.includeThinking ?? this.inTurn;
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

  private async showThinkingIndicator(): Promise<void> {
    const updated = await this.updateSlack("", { includeThinking: true });
    if (updated) {
      this.lastProgressText = "";
      this.lastProgressUpdateAt = Date.now();
    }
  }

  private async finalizeTurn(text: string): Promise<void> {
    const normalized = text.trim();
    if (normalized.length === 0) {
      if (!this.awaitingUserAction) {
        await this.finalizeError("완료했지만 출력이 비어있어요. 다시 시도해 주세요.");
        return;
      }
      this.finishTurn();
      return;
    }

    const updated = await this.updateSlack(normalized, { includeThinking: false });
    if (updated) {
      this.lastProgressText = normalized;
      this.lastProgressUpdateAt = Date.now();
    }

    if (this.awaitingUserAction) {
      this.finishTurn();
      return;
    }

    this.finishTurn();
  }

  private async finalizeError(message: string): Promise<void> {
    const normalized = message.trim();
    const text = normalized.length > 0 ? `⚠️ ${normalized}` : "⚠️ 알 수 없는 오류";
    const updated = await this.updateSlack(text, { includeThinking: false });
    if (updated) {
      this.lastProgressText = text;
      this.lastProgressUpdateAt = Date.now();
    }
    this.finishTurn();
  }

  private startNextTurn(): void {
    const next = this.pendingTurns.shift();
    if (!next) {
      return;
    }
    this.inTurn = true;
    this.outputMessageTs = null;
    this.lastEnsureOutputAt = 0;
    this.resetProgressState(next.isSynthetic);
    void this.showThinkingIndicator().catch(() => undefined);
  }

  private finishTurn(): void {
    this.inTurn = false;
    this.awaitingUserAction = false;
    this.awaitingUserActionHint = null;
    this.hasDraftOutput = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;
    this.progressPhase = "idle";
    this.progressDetail = null;
    this.outputMessageTs = null;
    this.lastEnsureOutputAt = 0;
    this.lastProgressText = null;
    this.lastProgressUpdateAt = 0;
    if (this.pendingProgressTimer) {
      clearTimeout(this.pendingProgressTimer);
      this.pendingProgressTimer = null;
      this.pendingForceProgress = false;
    }
    if (this.pendingTurns.length > 0) {
      this.startNextTurn();
    }
  }

  private resetProgressState(isSynthetic: boolean): void {
    this.awaitingUserAction = false;
    this.awaitingUserActionHint = null;
    this.hasDraftOutput = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;
    this.lastProgressText = null;
    this.lastProgressUpdateAt = 0;
    if (this.pendingProgressTimer) {
      clearTimeout(this.pendingProgressTimer);
      this.pendingProgressTimer = null;
      this.pendingForceProgress = false;
    }
    const detail = isSynthetic ? "사용자 확인을 반영했어요. 이어서 처리할게요." : null;
    this.setPhase("acknowledged", detail, { force: true });
  }

  private queueProgressUpdate(force: boolean): void {
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
    const text = this.renderProgressMessage();
    if (!text) {
      return;
    }

    if (!force && text === this.lastProgressText) {
      return;
    }

    const updated = await this.updateSlack(text);
    if (!updated) {
      return;
    }

    this.lastProgressText = text;
    this.lastProgressUpdateAt = Date.now();
  }

  private setPhase(nextPhase: ProgressPhase, detail: string | null = null, options?: { force?: boolean }): boolean {
    if (this.awaitingUserAction && nextPhase !== "waiting" && nextPhase !== "completed" && nextPhase !== "error") {
      return false;
    }

    const normalizedDetail = detail?.trim() ?? null;
    const changed = this.progressPhase !== nextPhase || this.progressDetail !== normalizedDetail;

    this.progressPhase = nextPhase;
    this.progressDetail = normalizedDetail;

    if (changed || options?.force) {
      this.queueProgressUpdate(options?.force ?? false);
    }

    return changed;
  }

  private markAwaitingUserAction(hint: string | null): void {
    const normalizedHint = hint?.trim() ?? null;
    const changed = !this.awaitingUserAction || this.awaitingUserActionHint !== normalizedHint;
    this.awaitingUserAction = true;
    this.awaitingUserActionHint = normalizedHint;
    if (changed) {
      this.setPhase("waiting", null, { force: true });
    }
  }

  private updateAssistantText(nextText: string): boolean {
    const normalized = nextText.trim();
    if (normalized.length === 0) {
      return false;
    }

    if (!this.lastAssistantText) {
      this.lastAssistantText = normalized;
      return true;
    }

    if (normalized === this.lastAssistantText) {
      return false;
    }

    if (normalized.startsWith(this.lastAssistantText)) {
      this.lastAssistantText = normalized;
      return true;
    }

    if (this.lastAssistantText.startsWith(normalized)) {
      return false;
    }

    this.lastAssistantText = normalized;
    return true;
  }

  private appendAssistantDelta(deltaText: string): boolean {
    if (deltaText.length === 0) {
      return false;
    }

    const current = this.streamingAssistantText ?? "";
    this.streamingAssistantText = current + deltaText;
    return this.noteAssistantDraft(this.streamingAssistantText);
  }

  private noteAssistantDraft(nextText: string): boolean {
    const changed = this.updateAssistantText(nextText);
    if (!this.hasDraftOutput) {
      this.hasDraftOutput = true;
      if (!this.awaitingUserAction && this.toolCallsById.size === 0) {
        this.setPhase("drafting");
      }
    }
    return changed;
  }

  private registerToolCall(params: { id: string; name: string }): boolean {
    const id = params.id.trim();
    const name = params.name.trim();
    if (id.length === 0 || name.length === 0) {
      return false;
    }

    const existing = this.toolCallsById.get(id);
    const meta = resolveToolMeta(name);
    if (existing) {
      let changed = false;
      if (existing.name !== name) {
        existing.name = name;
        changed = true;
      }
      if (meta.userActionHint) {
        this.markAwaitingUserAction(meta.userActionHint);
      } else if (!this.awaitingUserAction) {
        this.setPhase("working");
      }
      if (changed) {
        this.queueProgressUpdate(false);
      }
      return changed;
    }

    const entry: ToolCallEntry = {
      id,
      name,
      status: "running",
      startedAt: Date.now(),
      endedAt: null,
    };

    this.toolCallsById.set(id, entry);
    logToolCall({ phase: "start", id: entry.id, name: entry.name, status: entry.status });
    if (meta.userActionHint) {
      this.markAwaitingUserAction(meta.userActionHint);
    } else if (!this.awaitingUserAction) {
      this.setPhase("working");
    }
    this.queueProgressUpdate(false);
    return true;
  }

  private completeToolCall(params: { toolUseId: string; isError: boolean }): boolean {
    const toolUseId = params.toolUseId.trim();
    if (toolUseId.length === 0) {
      return false;
    }

    const entry = this.toolCallsById.get(toolUseId);
    if (!entry) {
      return false;
    }

    const nextStatus: ToolCallStatus = params.isError ? "error" : "success";
    if (entry.status === nextStatus) {
      return false;
    }

    entry.status = nextStatus;
    entry.endedAt = Date.now();
    this.toolCallsById.delete(toolUseId);
    logToolCall({
      phase: "complete",
      id: entry.id,
      name: entry.name,
      status: entry.status,
      durationMs: Math.max(0, entry.endedAt - entry.startedAt),
    });

    if (params.isError && entry.name === "mcp__sena-slack__search_messages") {
      this.markAwaitingUserAction("Slack 검색 권한 연동");
    }

    if (!this.awaitingUserAction && this.toolCallsById.size === 0 && this.hasDraftOutput) {
      this.setPhase("drafting");
    }

    this.queueProgressUpdate(false);
    return true;
  }

  private renderProgressMessage(): string | null {
    if (this.lastAssistantText) {
      return this.lastAssistantText;
    }

    if (this.progressPhase === "error") {
      const detail = this.progressDetail ?? "알 수 없는 오류";
      return `⚠️ ${detail}`;
    }

    return null;
  }

  private async runLoop(): Promise<void> {
    // const githubCredential = await findGithubCredentialBySlackUserId(this.slack.slackUserId);
    // const githubToken = githubCredential?.accessToken ?? null;

    await fs.mkdir(CONFIG.WORKSPACE_DIR, { recursive: true });

    const env = {
      ...sanitizeEnv(process.env),
      // ...(githubToken ? { GITHUB_TOKEN: githubToken, GH_TOKEN: githubToken } : {}),
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
          this.registerToolCall({
            id: toolProgress.toolUseId,
            name: toolProgress.toolName,
          });
          continue;
        }

        let shouldContinue = false;

        const toolResults = extractToolResults(message);
        if (toolResults.length > 0) {
          for (const result of toolResults) {
            this.completeToolCall({ toolUseId: result.toolUseId, isError: result.isError });
          }
          shouldContinue = true;
        }

        const streamDelta = extractStreamDeltaText(message);
        if (streamDelta) {
          if (this.appendAssistantDelta(streamDelta)) {
            const shouldForce = this.outputMessageTs === null || this.lastProgressText === "";
            this.queueProgressUpdate(shouldForce);
          }
          shouldContinue = true;
        }

        const assistantText = extractAssistantText(message);
        if (assistantText) {
          if (this.noteAssistantDraft(assistantText)) {
            const shouldForce = this.outputMessageTs === null || this.lastProgressText === "";
            this.queueProgressUpdate(shouldForce);
          }
          shouldContinue = true;
        }

        const toolUses = extractToolUses(message);
        if (toolUses.length > 0) {
          for (const toolUse of toolUses) {
            this.registerToolCall({ id: toolUse.id, name: toolUse.name });
          }
          shouldContinue = true;
        }

        if (shouldContinue) {
          continue;
        }

        const resultText = extractResultText(message);
        if (resultText) {
          this.finalAnswer = resultText;
          await this.finalizeTurn(resultText);
        }
      }
    } catch (error) {
      if (this.stopReason) {
        return;
      }
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      await this.finalizeError(message);
      return;
    } finally {
      this.ended = true;
      this.promptQueue.close();
    }

    if (this.stopReason) {
      return;
    }

    if (this.inTurn) {
      const fallback = this.finalAnswer?.trim() ? this.finalAnswer : this.lastAssistantText;
      if (fallback) {
        await this.finalizeTurn(fallback);
        return;
      }

      if (this.awaitingUserAction) {
        this.finishTurn();
        return;
      }

      await this.finalizeError("완료했지만 출력이 비어있어요. 다시 시도해 주세요.");
    }
  }
}

export class SlackClaudeAgent {
  private static _instance: SlackClaudeAgent | null = null;

  private threadSessions = new Map<string, string>();
  private threadRunners = new Map<string, SlackThreadRunner>();
  private threadSessionStore = new SlackThreadSessionStore({
    filePath: path.join(CONFIG.WORKSPACE_DIR, "slack-thread-sessions.json"),
  });

  static get instance(): SlackClaudeAgent {
    if (!SlackClaudeAgent._instance) {
      SlackClaudeAgent._instance = new SlackClaudeAgent();
    }
    return SlackClaudeAgent._instance;
  }

  async handleMention(_params: {
    teamId: string | null;
    channelId: string;
    userId: string | null;
    text: string;
    threadTs: string | null;
    messageTs: string | null;
  }): Promise<void> {
    const { teamId, channelId, userId, text, threadTs, messageTs } = _params;
    const normalizedText = text.replace(/^<@[A-Z0-9]+>\s*/u, "").trim();
    if (normalizedText.length === 0) {
      return;
    }

    const slackUserId = userId?.trim() || null;
    if (!slackUserId) {
      await SlackSDK.instance.postMessage({
        channel: channelId,
        thread_ts: threadTs ?? messageTs ?? undefined,
        text: "⚠️ Slack 사용자 ID를 확인할 수 없습니다.",
      });
      return;
    }

    const resolvedMessageTs = messageTs?.trim() || threadTs?.trim() || null;
    if (!resolvedMessageTs) {
      await SlackSDK.instance.postMessage({
        channel: channelId,
        thread_ts: threadTs ?? undefined,
        text: "⚠️ 메시지 타임스탬프를 확인할 수 없습니다.",
      });
      return;
    }

    const resolvedThreadTs = resolveThreadTs(threadTs, resolvedMessageTs);
    const threadKey = buildThreadKey(channelId, resolvedThreadTs);
    let resumeSessionId = this.threadSessions.get(threadKey) ?? null;
    if (!resumeSessionId) {
      resumeSessionId = (await this.threadSessionStore.get(threadKey).catch(() => null)) ?? null;
      if (resumeSessionId) {
        this.threadSessions.set(threadKey, resumeSessionId);
      }
    }

    const runner = this.getOrCreateRunner({
      threadKey,
      slack: {
        teamId,
        channelId,
        threadTs: resolvedThreadTs,
        messageTs: resolvedMessageTs,
        slackUserId,
      },
      resumeSessionId,
    });

    const accepted = runner.enqueueUserInput(normalizedText);
    if (!accepted) {
      this.getOrCreateRunner({
        threadKey,
        slack: {
          teamId,
          channelId,
          threadTs: resolvedThreadTs,
          messageTs: resolvedMessageTs,
          slackUserId,
        },
        resumeSessionId,
        forceNew: true,
      }).enqueueUserInput(normalizedText);
    }
  }

  async resumeSessionFromLinkToken(_params: {
    sessionId: string;
    slack: SlackContext;
    provider: "slack" | "github";
    continuationText: string;
  }): Promise<boolean> {
    const sessionId = _params.sessionId.trim();
    if (sessionId.length === 0) {
      return false;
    }

    const resolvedThreadTs = resolveThreadTs(_params.slack.threadTs, _params.slack.messageTs);
    const threadKey = buildThreadKey(_params.slack.channelId, resolvedThreadTs);

    this.threadSessions.set(threadKey, sessionId);
    void this.threadSessionStore.set(threadKey, sessionId).catch(() => undefined);

    const shouldRestart = _params.provider === "github";
    if (shouldRestart) {
      this.stopRunner(threadKey);
    }

    const runner = this.getOrCreateRunner({
      threadKey,
      slack: {
        ..._params.slack,
        threadTs: resolvedThreadTs,
      },
      resumeSessionId: sessionId,
      forceNew: shouldRestart,
    });

    const accepted = runner.enqueueUserInput(_params.continuationText, { isSynthetic: true });
    if (!accepted) {
      this.getOrCreateRunner({
        threadKey,
        slack: {
          ..._params.slack,
          threadTs: resolvedThreadTs,
        },
        resumeSessionId: sessionId,
        forceNew: true,
      }).enqueueUserInput(_params.continuationText, { isSynthetic: true });
    }
    return true;
  }

  private stopRunner(threadKey: string): void {
    const runner = this.threadRunners.get(threadKey);
    if (!runner) {
      return;
    }
    runner.stop({ reason: "restart", abort: true });
    this.threadRunners.delete(threadKey);
  }

  private getOrCreateRunner(params: {
    threadKey: string;
    slack: SlackContext;
    resumeSessionId: string | null;
    forceNew?: boolean;
  }): SlackThreadRunner {
    const existing = params.forceNew ? null : this.threadRunners.get(params.threadKey);
    if (existing?.canAcceptInput()) {
      existing.updateSlackContext(params.slack);
      return existing;
    }

    const threadKey = params.threadKey;
    const runner = new SlackThreadRunner({
      initialSlack: params.slack,
      resumeSessionId: params.resumeSessionId,
      onSessionId: (sessionId) => {
        this.threadSessions.set(threadKey, sessionId);
        void this.threadSessionStore.set(threadKey, sessionId).catch(() => undefined);
      },
      onStop: () => {
        const current = this.threadRunners.get(threadKey);
        if (current === runner) {
          this.threadRunners.delete(threadKey);
        }
      },
    });

    this.threadRunners.set(threadKey, runner);
    return runner;
  }
}
