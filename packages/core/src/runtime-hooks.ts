import type { TurnContext, TurnResult, ContextFragment } from './types.js'

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
  | { decision: 'allow'; fragments: ContextFragment[] }
  | { decision: 'block'; reason: string }

export type TurnEndResult = void | {
  /** Execute a follow-up prompt after this turn */
  followUp?: string
  /** Fork into a new session (inherits current session context via resume). Requires followUp. */
  fork?: boolean
  /** Suppress connector output for the forked turn. Only effective when fork is true. */
  detached?: boolean
}

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

