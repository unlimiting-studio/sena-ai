type ToolCallStatus = "running" | "success" | "error";

type ToolCallEntry = {
  name: string;
  startedAt: number;
};

const USER_ACTION_TOOL_PATTERNS: ReadonlyArray<RegExp> = [
  /^mcp__sena-auth__guide_github_integration$/u,
  /^mcp__sena-auth__guide_repo_permission$/u,
];

const isUserActionTool = (toolName: string): boolean => {
  const normalized = toolName.trim();
  if (normalized.length === 0) {
    return false;
  }
  return USER_ACTION_TOOL_PATTERNS.some((pattern) => pattern.test(normalized));
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

const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export class SlackThreadProgress {
  private awaitingUserAction = false;
  private toolCallsById = new Map<string, ToolCallEntry>();
  private lastAssistantText: string | null = null;
  private streamingAssistantText: string | null = null;
  private finalAnswer: string | null = null;
  private errorDetail: string | null = null;

  resetForTurn(): void {
    this.awaitingUserAction = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;
    this.errorDetail = null;
  }

  clearAfterTurn(): void {
    this.awaitingUserAction = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;
    this.errorDetail = null;
  }

  setError(detail: string | null): boolean {
    const normalized = normalizeOptionalText(detail) ?? "알 수 없는 오류";
    if (this.errorDetail === normalized) {
      return false;
    }
    this.errorDetail = normalized;
    return true;
  }

  isAwaitingUserAction(): boolean {
    return this.awaitingUserAction;
  }

  getFinalAnswer(): string | null {
    return this.finalAnswer;
  }

  getLastAssistantText(): string | null {
    return this.lastAssistantText;
  }

  renderProgressMessage(): string | null {
    if (this.lastAssistantText) {
      return this.lastAssistantText;
    }

    if (this.errorDetail) {
      return `⚠️ ${this.errorDetail}`;
    }

    return null;
  }

  setFinalAnswer(resultText: string): void {
    this.finalAnswer = normalizeOptionalText(resultText);
  }

  noteAssistantText(nextText: string): boolean {
    return this.updateAssistantText(nextText);
  }

  appendAssistantDelta(deltaText: string): boolean {
    if (deltaText.length === 0) {
      return false;
    }

    const current = this.streamingAssistantText ?? "";
    this.streamingAssistantText = current + deltaText;
    return this.updateAssistantText(this.streamingAssistantText);
  }

  registerToolCall(params: { id: string; name: string }): boolean {
    const id = params.id.trim();
    const name = params.name.trim();
    if (id.length === 0 || name.length === 0) {
      return false;
    }

    let changed = false;
    const existing = this.toolCallsById.get(id);
    if (!existing) {
      this.toolCallsById.set(id, { name, startedAt: Date.now() });
      logToolCall({ phase: "start", id, name, status: "running" });
      changed = true;
    } else if (existing.name !== name) {
      existing.name = name;
      changed = true;
    }

    if (isUserActionTool(name)) {
      changed = this.markAwaitingUserAction() || changed;
    }

    return changed;
  }

  completeToolCall(params: { toolUseId: string; isError: boolean }): boolean {
    const toolUseId = params.toolUseId.trim();
    if (toolUseId.length === 0) {
      return false;
    }

    const entry = this.toolCallsById.get(toolUseId);
    if (!entry) {
      return false;
    }

    this.toolCallsById.delete(toolUseId);
    logToolCall({
      phase: "complete",
      id: toolUseId,
      name: entry.name,
      status: params.isError ? "error" : "success",
      durationMs: Math.max(0, Date.now() - entry.startedAt),
    });

    let changed = true;

    if (params.isError && entry.name === "mcp__sena-slack__search_messages") {
      changed = this.markAwaitingUserAction() || changed;
    }

    return changed;
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

  private markAwaitingUserAction(): boolean {
    if (this.awaitingUserAction) {
      return false;
    }
    this.awaitingUserAction = true;
    return true;
  }
}
