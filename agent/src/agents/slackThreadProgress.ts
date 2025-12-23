export type ProgressPhase = "idle" | "acknowledged" | "working" | "drafting" | "waiting" | "completed" | "error";

type ToolMeta = {
  userActionHint?: string;
};

type ToolCallStatus = "running" | "success" | "error";

type ToolCallEntry = {
  id: string;
  name: string;
  status: ToolCallStatus;
  startedAt: number;
  endedAt: number | null;
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
  private phase: ProgressPhase = "idle";
  private detail: string | null = null;
  private awaitingUserAction = false;
  private awaitingUserActionHint: string | null = null;
  private hasDraftOutput = false;
  private toolCallsById = new Map<string, ToolCallEntry>();
  private lastAssistantText: string | null = null;
  private streamingAssistantText: string | null = null;
  private finalAnswer: string | null = null;

  resetForTurn(isSynthetic: boolean): void {
    this.awaitingUserAction = false;
    this.awaitingUserActionHint = null;
    this.hasDraftOutput = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;

    const detail = isSynthetic ? "사용자 확인을 반영했어요. 이어서 처리할게요." : null;
    this.setPhase("acknowledged", detail);
  }

  clearAfterTurn(): void {
    this.awaitingUserAction = false;
    this.awaitingUserActionHint = null;
    this.hasDraftOutput = false;
    this.toolCallsById.clear();
    this.lastAssistantText = null;
    this.streamingAssistantText = null;
    this.finalAnswer = null;
    this.phase = "idle";
    this.detail = null;
  }

  setError(detail: string | null): boolean {
    return this.setPhase("error", detail);
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

    if (this.phase === "error") {
      const detail = this.detail ?? "알 수 없는 오류";
      return `⚠️ ${detail}`;
    }

    return null;
  }

  setFinalAnswer(resultText: string): void {
    this.finalAnswer = normalizeOptionalText(resultText);
  }

  noteAssistantText(nextText: string): boolean {
    return this.noteAssistantDraft(nextText);
  }

  appendAssistantDelta(deltaText: string): boolean {
    if (deltaText.length === 0) {
      return false;
    }

    const current = this.streamingAssistantText ?? "";
    this.streamingAssistantText = current + deltaText;
    return this.noteAssistantDraft(this.streamingAssistantText);
  }

  registerToolCall(params: { id: string; name: string }): boolean {
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

      const phaseChanged = meta.userActionHint
        ? this.markAwaitingUserAction(meta.userActionHint)
        : !this.awaitingUserAction && this.setPhase("working");

      return changed || phaseChanged;
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

    return true;
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

    let changed = true;

    if (params.isError && entry.name === "mcp__sena-slack__search_messages") {
      changed = this.markAwaitingUserAction("Slack 검색 권한 연동") || changed;
    }

    if (!this.awaitingUserAction && this.toolCallsById.size === 0 && this.hasDraftOutput) {
      changed = this.setPhase("drafting") || changed;
    }

    return changed;
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

  private setPhase(nextPhase: ProgressPhase, detail: string | null = null): boolean {
    if (this.awaitingUserAction && nextPhase !== "waiting" && nextPhase !== "completed" && nextPhase !== "error") {
      return false;
    }

    const normalizedDetail = normalizeOptionalText(detail);
    const changed = this.phase !== nextPhase || this.detail !== normalizedDetail;

    this.phase = nextPhase;
    this.detail = normalizedDetail;

    return changed;
  }

  private markAwaitingUserAction(hint: string | null): boolean {
    const normalizedHint = normalizeOptionalText(hint);
    const changed = !this.awaitingUserAction || this.awaitingUserActionHint !== normalizedHint;
    this.awaitingUserAction = true;
    this.awaitingUserActionHint = normalizedHint;
    const phaseChanged = this.setPhase("waiting", null);
    return changed || phaseChanged;
  }
}
