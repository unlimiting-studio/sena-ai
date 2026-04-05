import type {
  RuntimeHooks,
  PreToolUseInput,
  PostToolUseInput,
  StopInput,
  SessionStartInput,
  PreToolUseDecision,
  TurnContext,
} from '@sena-ai/core'

// ─── SDK Hook Types ────────────────────────────────────────────────
// These mirror the Claude Agent SDK's hook system types.

type HookJSONOutput = Record<string, unknown>

type HookCallback = (
  input: any,
  toolUseID: string | undefined,
  context: { signal: AbortSignal },
) => Promise<HookJSONOutput>

type HookCallbackMatcher = {
  matcher?: string
  hooks: HookCallback[]
  timeout?: number
}

type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop' | 'SessionStart'

export type SdkHooks = Partial<Record<HookEvent, HookCallbackMatcher[]>>

// ─── Stub TurnContext ──────────────────────────────────────────────
// The SDK hooks don't supply a TurnContext, so we provide a minimal stub.

const STUB_TURN_CONTEXT: TurnContext = {
  turnId: '',
  agentName: '',
  trigger: 'programmatic',
  input: '',
  sessionId: null,
  metadata: {},
}

// ─── Adapter ───────────────────────────────────────────────────────

/**
 * Converts Sena RuntimeHooks into the Claude Agent SDK `hooks` option format.
 */
export function buildSdkHooks(runtimeHooks: RuntimeHooks): SdkHooks {
  const sdkHooks: SdkHooks = {}

  if (runtimeHooks.onPreToolUse?.length) {
    sdkHooks.PreToolUse = runtimeHooks.onPreToolUse.map((matcher) => {
      const cb: HookCallback = async (input) => {
        try {
          const senaInput: PreToolUseInput = {
            hookEventName: 'preToolUse',
            toolName: input?.tool_name ?? '',
            toolInput: input?.tool_input ?? {},
            turnContext: STUB_TURN_CONTEXT,
          }
          const decision = await matcher.callback(senaInput)
          return mapPreToolUseDecision(decision)
        } catch (err) {
          console.error('[hook-adapter] PreToolUse hook error:', err)
          return {}
        }
      }
      return {
        ...(matcher.toolName ? { matcher: matcher.toolName.source } : {}),
        hooks: [cb],
      }
    })
  }

  if (runtimeHooks.onPostToolUse?.length) {
    sdkHooks.PostToolUse = runtimeHooks.onPostToolUse.map((matcher) => {
      const cb: HookCallback = async (input) => {
        try {
          const senaInput: PostToolUseInput = {
            hookEventName: 'postToolUse',
            toolName: input?.tool_name ?? '',
            toolInput: input?.tool_input ?? {},
            toolOutput: input?.tool_output ?? '',
            isError: input?.is_error ?? false,
            turnContext: STUB_TURN_CONTEXT,
          }
          const result = await matcher.callback(senaInput)
          if (result && 'additionalContext' in result) {
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: result.additionalContext,
              },
            }
          }
          return {
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
            },
          }
        } catch (err) {
          console.error('[hook-adapter] PostToolUse hook error:', err)
          return {}
        }
      }
      return {
        ...(matcher.toolName ? { matcher: matcher.toolName.source } : {}),
        hooks: [cb],
      }
    })
  }

  // onTurnStart is handled by the engine directly — not mapped to SDK hooks.

  if (runtimeHooks.onStop?.length) {
    sdkHooks.Stop = runtimeHooks.onStop.map((callback) => {
      const cb: HookCallback = async (input) => {
        try {
          const senaInput: StopInput = {
            hookEventName: 'stop',
            reason: input?.reason ?? 'endTurn',
            turnContext: STUB_TURN_CONTEXT,
          }
          const result = await callback(senaInput)
          if (result && 'continueWith' in result) {
            return { decision: 'block', reason: result.continueWith }
          }
          return {}
        } catch (err) {
          console.error('[hook-adapter] Stop hook error:', err)
          return {}
        }
      }
      return { hooks: [cb] }
    })
  }

  if (runtimeHooks.onSessionStart?.length) {
    sdkHooks.SessionStart = runtimeHooks.onSessionStart.map((callback) => {
      const cb: HookCallback = async (input) => {
        try {
          const senaInput: SessionStartInput = {
            hookEventName: 'sessionStart',
            sessionId: input?.session_id ?? '',
            turnContext: STUB_TURN_CONTEXT,
          }
          const result = await callback(senaInput)
          if (result && 'additionalContext' in result) {
            return {
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                additionalContext: result.additionalContext,
              },
            }
          }
          return {
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
            },
          }
        } catch (err) {
          console.error('[hook-adapter] SessionStart hook error:', err)
          return {}
        }
      }
      return { hooks: [cb] }
    })
  }

  return sdkHooks
}

// ─── Decision Mappers ──────────────────────────────────────────────

function mapPreToolUseDecision(decision: PreToolUseDecision): HookJSONOutput {
  switch (decision.decision) {
    case 'allow': {
      const output: Record<string, unknown> = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          ...('updatedInput' in decision ? { updatedInput: decision.updatedInput } : {}),
        },
      }
      return output
    }
    case 'deny':
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      }
    case 'pass':
      return {}
    default:
      return {}
  }
}


// ─── Default Slack Block Hook ──────────────────────────────────────

const SLACK_TOOL_PATTERN = /^mcp__claude_ai_Slack__/

/**
 * A PreToolUse hook that denies any tool matching the Claude AI Slack MCP pattern.
 * Prevents the agent from accidentally acting under the human user's Slack identity.
 */
export const defaultSlackBlockHook: import('@sena-ai/core').PreToolUseCallback = async (
  input: PreToolUseInput,
): Promise<PreToolUseDecision> => {
  if (SLACK_TOOL_PATTERN.test(input.toolName)) {
    return {
      decision: 'deny',
      reason: 'Slack tools from the Claude AI integration are blocked to prevent acting under the human user\'s identity.',
    }
  }
  return { decision: 'pass' }
}
