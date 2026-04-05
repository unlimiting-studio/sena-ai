import type { ContextFragment, TurnContext, TurnResult, TurnStartHook, TurnEndHook, ErrorHook } from './types.js'

// ─── Hook Input Types ───────────────────────────────────────────────

export type PreToolUseInput = {
  hookEventName: 'preToolUse'
  toolName: string
  toolInput: Record<string, unknown>
  turnContext: TurnContext
}

export type PostToolUseInput = {
  hookEventName: 'postToolUse'
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: string
  isError: boolean
  turnContext: TurnContext
}

export type TurnStartInput = {
  hookEventName: 'turnStart'
  prompt: string
  turnContext: TurnContext
}

export type TurnEndInput = {
  hookEventName: 'turnEnd'
  result: TurnResult
  turnContext: TurnContext
}

export type StopInput = {
  hookEventName: 'stop'
  reason: 'endTurn' | 'maxTurns' | 'abort'
  turnContext: TurnContext
}

export type SessionStartInput = {
  hookEventName: 'sessionStart'
  sessionId: string
  turnContext: TurnContext
}

export type ErrorInput = {
  hookEventName: 'error'
  error: Error
  turnContext: TurnContext
}

export type HookInput =
  | PreToolUseInput
  | PostToolUseInput
  | TurnStartInput
  | TurnEndInput
  | StopInput
  | SessionStartInput
  | ErrorInput

// ─── Hook Output Types ──────────────────────────────────────────────

export type PreToolUseDecision =
  | { decision: 'allow' }
  | { decision: 'allow'; updatedInput: Record<string, unknown> }
  | { decision: 'deny'; reason: string }
  | { decision: 'pass' }

export type PostToolUseResult = void | { additionalContext: string }

export type TurnStartDecision =
  | { decision: 'allow' }
  | { decision: 'allow'; additionalContext: string }
  | { decision: 'block'; reason: string }
  | { decision: 'modifiedPrompt'; prompt: string }
  | { decision: 'modifiedPrompt'; prompt: string; additionalContext: string }

export type TurnEndResult = void

export type StopDecision = void | { continueWith: string }

export type SessionStartResult = void | { additionalContext: string }

export type ErrorResult = void

// ─── Callback Types ─────────────────────────────────────────────────

export type PreToolUseCallback = (input: PreToolUseInput) => Promise<PreToolUseDecision>
export type PostToolUseCallback = (input: PostToolUseInput) => Promise<PostToolUseResult>
export type TurnStartCallback = (input: TurnStartInput) => Promise<TurnStartDecision>
export type TurnEndCallback = (input: TurnEndInput) => Promise<TurnEndResult>
export type StopCallback = (input: StopInput) => Promise<StopDecision>
export type SessionStartCallback = (input: SessionStartInput) => Promise<SessionStartResult>
export type ErrorCallback = (input: ErrorInput) => Promise<ErrorResult>

// ─── Matcher Types ──────────────────────────────────────────────────

export type ToolHookMatcher<T> = {
  /** Optional regex pattern to match tool names. If omitted, matches all tools. */
  toolName?: RegExp
  callback: T
}

// ─── RuntimeHooks ───────────────────────────────────────────────────

export type RuntimeHooks = {
  onPreToolUse?: ToolHookMatcher<PreToolUseCallback>[]
  onPostToolUse?: ToolHookMatcher<PostToolUseCallback>[]
  onTurnStart?: TurnStartCallback[]
  onTurnEnd?: TurnEndCallback[]
  onStop?: StopCallback[]
  onSessionStart?: SessionStartCallback[]
  onError?: ErrorCallback[]
}

// ─── Legacy Adapter ─────────────────────────────────────────────────

function fragmentsToContext(fragments: ContextFragment[]): string {
  return fragments.map((f) => f.content).join('\n')
}

/**
 * Converts legacy TurnStartHook / TurnEndHook / ErrorHook arrays
 * into the new RuntimeHooks format, merging with any existing RuntimeHooks.
 *
 * @deprecated Legacy hooks will be removed in a future version.
 */
export function adaptLegacyHooks(
  legacy: {
    onTurnStart?: TurnStartHook[]
    onTurnEnd?: TurnEndHook[]
    onError?: ErrorHook[]
  },
  existing?: RuntimeHooks,
): RuntimeHooks {
  const hooks: RuntimeHooks = {
    ...existing,
  }

  if (legacy.onTurnStart?.length) {
    console.warn('[sena] onTurnStart hooks are deprecated. Use hooks.onTurnStart instead.')
    const adapted: TurnStartCallback[] = legacy.onTurnStart.map((h) =>
      async (input: TurnStartInput): Promise<TurnStartDecision> => {
        const fragments = await h.execute(input.turnContext)
        if (fragments.length === 0) {
          return { decision: 'allow' }
        }
        return { decision: 'allow', additionalContext: fragmentsToContext(fragments) }
      },
    )
    hooks.onTurnStart = [...adapted, ...(existing?.onTurnStart ?? [])]
  }

  if (legacy.onTurnEnd?.length) {
    console.warn('[sena] onTurnEnd hooks are deprecated. Use hooks.onTurnEnd instead.')
    const adapted: TurnEndCallback[] = legacy.onTurnEnd.map((h) =>
      async (input: TurnEndInput): Promise<TurnEndResult> => {
        await h.execute(input.turnContext, input.result)
      },
    )
    hooks.onTurnEnd = [...adapted, ...(existing?.onTurnEnd ?? [])]
  }

  if (legacy.onError?.length) {
    console.warn('[sena] onError hooks are deprecated. Use hooks.onError instead.')
    const adapted: ErrorCallback[] = legacy.onError.map((h) =>
      async (input: ErrorInput): Promise<ErrorResult> => {
        await h.execute(input.turnContext, input.error)
      },
    )
    hooks.onError = [...adapted, ...(existing?.onError ?? [])]
  }

  return hooks
}
