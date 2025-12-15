import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { CONFIG } from "../config.ts";
import { findGithubCredentialBySlackUserId } from "../db/githubCredentials.ts";
import { createKarbyHitlMcpServer } from "../mcp/hitlMcp.ts";
import { createKarbySlackMcpServer } from "../mcp/slackMcp.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { sanitizeEnv } from "../utils/env.ts";
import { isRecord } from "../utils/object.ts";

export type SlackContext = {
  teamId: string | null;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  slackUserId: string;
};

const DEFAULT_MODEL = "claude-sonnet-4-5";

const MAX_SLACK_TEXT_LENGTH = 38_000;
const SLACK_UPDATE_THROTTLE_MS = 1500;
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

const KARBY_SYSTEM_PROMPT_APPEND = [
  "당신은 카비(Karby)입니다. Slack 멘션으로 호출되어 요청된 작업을 수행하는 사내 다기능 코딩 에이전트입니다.",
  "특히 코딩/리포지토리 분석/문서 조사에 강하며, Slack 동료에게 따뜻하고 친절한 동료처럼 응답합니다.",
  "",
  "[운영 컨텍스트]",
  "- 이 대화는 *Slack 스레드*에서 진행됩니다. 항상 스레드 맥락을 우선으로 파악하고 답하세요.",
  "- 사용자가 준 한 문장만으로 추측하지 말고, 필요하면 먼저 Slack 히스토리를 확인하세요.",
  "- 당신은 사용자와 서로 다른 시스템에서 실행됩니다. 사용자에게 로컬 파일/콘솔을 보라고 하거나, 당신이 만든 파일을 확인하라고 하지 마세요. 필요한 정보는 도구로 수집하고, 결과는 Slack 메시지로 전달하세요.",
  "- OAuth/권한 신청처럼 사용자의 확인이 필요한 단계(HITL)가 있으면, *왜 필요한지*와 *다음 행동*을 짧고 명확하게 안내하세요.",
  "",
  "[사용 가능한 도구]",
  "- Slack 컨텍스트 수집:",
  "  - `mcp__karby-slack__get_messages`: 현재 채널/스레드 메시지를 읽습니다.",
  "  - `mcp__karby-slack__search_messages`: 워크스페이스에서 메시지를 검색합니다. 권한이 없으면 연동 안내가 자동 전송됩니다.",
  "- GitHub 연동(HITL):",
  "  - `mcp__karby-auth__guide_github_integration`: GitHub OAuth 연동이 필요할 때 사용자에게 개인 메시지 안내를 보냅니다.",
  "  - `mcp__karby-auth__guide_repo_permission`: 특정 리포지토리(owner/repo)의 Write 권한이 필요할 때 확인/신청 안내를 보냅니다.",
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
  "5) 작업이 길어질 것 같으면, 현재 무엇을 하고 있는지 짧게 중간 업데이트를 포함합니다.",
].join("\n");

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

type ToolCallStatus = "running" | "success" | "error";

type ToolCallEntry = {
  id: string;
  name: string;
  status: ToolCallStatus;
  stepIndex: number;
  startedAt: number;
  endedAt: number | null;
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

  private resumeSessionId: string | null;
  private sessionId: string | null;
  private onSessionId: (sessionId: string) => void;
  private onStop: () => void;

  private outputMessageTs: string | null = null;
  private lastSlackUpdateAt = 0;
  private lastEnsureOutputAt = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private stopReason: "idle" | "restart" | "manual" | null = null;

  private assistantOutputs: string[] = [];
  private toolCalls: ToolCallEntry[] = [];
  private toolCallsById = new Map<string, ToolCallEntry>();
  private finalAnswer: string | null = null;
  private finalPosted = false;
  private finalInlineAnswer: string | null = null;
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
      .catch(async (error) => {
        if (this.stopReason) {
          return;
        }
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        await this.updateSlack(`⚠️ 실행 중 오류가 발생했습니다.\n\n${message}`, true);
      })
      .finally(() => {
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
  }

  enqueueUserInput(text: string, options?: { isSynthetic?: boolean }): void {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return;
    }

    if (!this.started) {
      this.start();
    }

    this.bumpIdleTimer();
    void this.showThinking().catch(() => undefined);

    const prompt = this.bootstrapped ? this.buildFollowupPrompt(normalized) : this.buildBootstrapPrompt(normalized);

    this.bootstrapped = true;
    this.promptQueue.push(this.toSdkUserMessage(prompt, { isSynthetic: options?.isSynthetic ?? false }));
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
      `[Slack Context] teamId=${this.slack.teamId ?? ""}, channelId=${this.slack.channelId}, threadTs=${threadTs}, messageTs=${this.slack.messageTs}, requesterSlackUserId=${this.slack.slackUserId}`,
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
      `[Slack Context] teamId=${this.slack.teamId ?? ""}, channelId=${this.slack.channelId}, threadTs=${threadTs}, messageTs=${this.slack.messageTs}, requesterSlackUserId=${this.slack.slackUserId}`,
      "",
      "[추가 요청]",
      userText,
    ].join("\n");
  }

  private async ensureOutputMessageTs(): Promise<string | null> {
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
        text: "카비가 생각중이에요…",
      })
      .catch(() => null);

    const ts = isRecord(placeholder) && typeof placeholder.ts === "string" ? placeholder.ts : null;
    if (ts) {
      this.outputMessageTs = ts;
    }
    return ts;
  }

  private async updateSlack(text: string, force: boolean): Promise<void> {
    const outputTs = await this.ensureOutputMessageTs();
    if (!outputTs) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastSlackUpdateAt < SLACK_UPDATE_THROTTLE_MS) {
      return;
    }
    this.lastSlackUpdateAt = now;

    await SlackSDK.instance
      .updateMessage({
        channel: this.slack.channelId,
        ts: outputTs,
        text: trimSlackText(text),
      })
      .catch(() => undefined);
  }

  private async showThinking(): Promise<void> {
    await this.updateSlack("카비가 생각중이에요…", true);
  }

  private getCurrentStepIndex(): number {
    return Math.max(this.assistantOutputs.length, 1);
  }

  private upsertAssistantOutput(nextText: string): boolean {
    const normalized = nextText.trim();
    if (normalized.length === 0) {
      return false;
    }

    if (this.assistantOutputs.length === 0) {
      this.assistantOutputs.push(normalized);
      return true;
    }

    const lastIndex = this.assistantOutputs.length - 1;
    const previous = this.assistantOutputs[lastIndex];

    if (normalized === previous) {
      return false;
    }

    if (normalized.startsWith(previous)) {
      this.assistantOutputs[lastIndex] = normalized;
      return true;
    }

    if (previous.startsWith(normalized)) {
      return false;
    }

    this.assistantOutputs.push(normalized);
    return true;
  }

  private registerToolCall(params: { id: string; name: string; stepIndex: number }): boolean {
    const id = params.id.trim();
    const name = params.name.trim();
    if (id.length === 0 || name.length === 0) {
      return false;
    }

    const existing = this.toolCallsById.get(id);
    if (existing) {
      if (existing.name.length === 0 && existing.name !== name) {
        existing.name = name;
        return true;
      }
      return false;
    }

    const entry: ToolCallEntry = {
      id,
      name,
      status: "running",
      stepIndex: params.stepIndex,
      startedAt: Date.now(),
      endedAt: null,
    };

    this.toolCalls.push(entry);
    this.toolCallsById.set(id, entry);
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
    return true;
  }

  private renderProgressMessage(): string {
    const lines: string[] = [];

    for (let index = 0; index < this.assistantOutputs.length; index += 1) {
      lines.push(`[에이전트 출력${index + 1}]`);
      lines.push(this.assistantOutputs[index]);
      lines.push("");
    }

    const currentStep = this.getCurrentStepIndex();
    const toolCallsToDisplay = this.toolCalls.filter(
      (call) => call.stepIndex === currentStep || call.status === "running",
    );

    if (toolCallsToDisplay.length > 0) {
      const tokens = toolCallsToDisplay
        .map((call) => {
          if (call.status === "success") {
            return `[${call.name} ✅]`;
          }
          if (call.status === "error") {
            return `[${call.name} ❌]`;
          }
          return `[${call.name}]`;
        })
        .join(" ");

      lines.push("[도구 호출]");
      lines.push(tokens);
    }

    if (this.finalPosted) {
      lines.push("");
      lines.push("---새 메시지---");
      if (this.finalInlineAnswer) {
        lines.push("");
        lines.push(this.finalInlineAnswer);
      }
    }

    const rendered = lines.join("\n").trim();
    return rendered.length > 0 ? rendered : "카비가 생각중이에요…";
  }

  private async updateProgress(force: boolean): Promise<void> {
    await this.updateSlack(this.renderProgressMessage(), force);
  }

  private async postFinalAnswer(text: string): Promise<boolean> {
    const normalized = text.trim();
    if (normalized.length === 0) {
      return false;
    }

    const finalText =
      normalized.length <= MAX_SLACK_TEXT_LENGTH
        ? normalized
        : `${normalized.slice(0, MAX_SLACK_TEXT_LENGTH)}\n\n...(truncated)`;

    const response = await SlackSDK.instance
      .postMessage({
        channel: this.slack.channelId,
        thread_ts: this.slack.threadTs ?? this.slack.messageTs,
        text: finalText,
      })
      .catch(() => null);

    return Boolean(isRecord(response) && response.ok === true);
  }

  private async runLoop(): Promise<void> {
    const githubCredential = await findGithubCredentialBySlackUserId(this.slack.slackUserId);
    const githubToken = githubCredential?.accessToken ?? null;

    const env = {
      ...sanitizeEnv(process.env),
      ...(githubToken ? { GITHUB_TOKEN: githubToken, GH_TOKEN: githubToken } : {}),
    };

    const slackMcp = createKarbySlackMcpServer({
      slack: this.slack,
      getSessionId: () => this.sessionId,
    });

    const hitlMcp = createKarbyHitlMcpServer({
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
        systemPrompt: { type: "preset", preset: "claude_code", append: KARBY_SYSTEM_PROMPT_APPEND },
        settingSources: ["user", "project", "local"],
        abortController: this.abortController,
        ...(this.resumeSessionId ? { resume: this.resumeSessionId } : {}),
        mcpServers: {
          "karby-slack": slackMcp,
          "karby-auth": hitlMcp,
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
          const changed = this.registerToolCall({
            id: toolProgress.toolUseId,
            name: toolProgress.toolName,
            stepIndex: this.getCurrentStepIndex(),
          });
          if (changed) {
            await this.updateProgress(false);
          }
          continue;
        }

        let shouldContinue = false;
        let hasChanged = false;
        let forceUpdate = false;

        const toolResults = extractToolResults(message);
        if (toolResults.length > 0) {
          let changedToolResults = false;
          for (const result of toolResults) {
            if (this.completeToolCall({ toolUseId: result.toolUseId, isError: result.isError })) {
              changedToolResults = true;
            }
          }

          if (changedToolResults) {
            hasChanged = true;
            forceUpdate = true;
          }
          shouldContinue = true;
        }

        const assistantText = extractAssistantText(message);
        if (assistantText) {
          const changedOutput = this.upsertAssistantOutput(assistantText);
          if (changedOutput) {
            hasChanged = true;
          }
          shouldContinue = true;
        }

        const toolUses = extractToolUses(message);
        if (toolUses.length > 0) {
          let changedTools = false;
          const stepIndex = this.getCurrentStepIndex();
          for (const toolUse of toolUses) {
            if (this.registerToolCall({ id: toolUse.id, name: toolUse.name, stepIndex })) {
              changedTools = true;
            }
          }
          if (changedTools) {
            hasChanged = true;
          }
          shouldContinue = true;
        }

        if (hasChanged) {
          await this.updateProgress(forceUpdate);
        }
        if (shouldContinue) {
          continue;
        }

        const resultText = extractResultText(message);
        if (resultText) {
          this.finalAnswer = resultText;
          await this.updateProgress(true);
        }
      }
    } catch (error) {
      if (this.stopReason) {
        return;
      }
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      const errorText = `⚠️ 실행 중 오류가 발생했습니다.\n\n${message}`;
      await this.updateSlack(errorText, true);
      return;
    }

    const hasFinalAnswer = this.stopReason === null && (this.finalAnswer?.trim().length ?? 0) > 0;
    if (hasFinalAnswer) {
      const posted = await this.postFinalAnswer(this.finalAnswer ?? "");
      this.finalPosted = true;
      if (!posted) {
        this.finalInlineAnswer = this.finalAnswer;
      }
      await this.updateProgress(true);
      return;
    }

    if (this.assistantOutputs.join("\n").trim().length === 0) {
      await this.updateSlack("완료했지만 출력이 비어있어요. 다시 시도해 주세요.", true);
    }
  }
}

export class SlackClaudeAgent {
  private static _instance: SlackClaudeAgent | null = null;

  private threadSessions = new Map<string, string>();
  private threadRunners = new Map<string, SlackThreadRunner>();

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
    const resumeSessionId = this.threadSessions.get(threadKey) ?? null;

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

    runner.enqueueUserInput(normalizedText);
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

    runner.enqueueUserInput(_params.continuationText, { isSynthetic: true });
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
    if (existing) {
      existing.updateSlackContext(params.slack);
      return existing;
    }

    const threadKey = params.threadKey;
    const runner = new SlackThreadRunner({
      initialSlack: params.slack,
      resumeSessionId: params.resumeSessionId,
      onSessionId: (sessionId) => {
        this.threadSessions.set(threadKey, sessionId);
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
