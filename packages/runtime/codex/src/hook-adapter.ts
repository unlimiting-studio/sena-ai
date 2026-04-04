import type {
  RuntimeHooks,
  PreToolUseDecision,
  PreToolUseInput,
  PostToolUseInput,
  TurnContext,
} from '@sena-ai/core'

/**
 * Evaluates all matching `onPreToolUse` hooks against the given tool invocation.
 *
 * - Matchers use regex pattern matching on tool name (Codex patterns: `shell:cmd`, `file:path`, etc.)
 * - A matcher with no `toolName` regex matches all tools.
 * - `deny` wins immediately — first deny short-circuits.
 * - `updatedInput` is NOT supported by Codex; logged as warning and treated as plain `allow`.
 * - Errors in callbacks are logged and treated as `pass`.
 * - Default (no decisive hook): `{ decision: 'allow' }`.
 */
export async function evaluatePreToolUse(
  hooks: RuntimeHooks,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string,
  sessionId: string,
  cwd: string,
): Promise<PreToolUseDecision> {
  const matchers = hooks.onPreToolUse
  if (!matchers || matchers.length === 0) {
    return { decision: 'allow' }
  }

  const turnContext: TurnContext = buildTurnContext(toolUseId, sessionId, cwd)

  const input: PreToolUseInput = {
    hookEventName: 'preToolUse',
    toolName,
    toolInput,
    turnContext,
  }

  for (const matcher of matchers) {
    if (matcher.toolName && !matcher.toolName.test(toolName)) {
      continue
    }

    try {
      const result = await matcher.callback(input)

      if (result.decision === 'pass') {
        continue
      }

      if (result.decision === 'deny') {
        return result
      }

      if (result.decision === 'allow') {
        if ('updatedInput' in result && result.updatedInput !== undefined) {
          console.warn(
            `[sena][codex] Hook returned updatedInput for tool "${toolName}", but Codex does not support input rewriting. Treating as plain allow.`,
          )
          return { decision: 'allow' }
        }
        return result
      }
    } catch (err) {
      console.error(
        `[sena][codex] PreToolUse hook error for tool "${toolName}":`,
        err,
      )
      // Treat error as pass — continue to next hook
    }
  }

  return { decision: 'allow' }
}

/**
 * Evaluates all matching `onPostToolUse` hooks (fire-and-forget).
 *
 * Same matcher logic as `evaluatePreToolUse`. Errors are logged and swallowed.
 */
export async function evaluatePostToolUse(
  hooks: RuntimeHooks,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: string,
  isError: boolean,
  toolUseId: string,
  sessionId: string,
  cwd: string,
): Promise<void> {
  const matchers = hooks.onPostToolUse
  if (!matchers || matchers.length === 0) {
    return
  }

  const turnContext: TurnContext = buildTurnContext(toolUseId, sessionId, cwd)

  const input: PostToolUseInput = {
    hookEventName: 'postToolUse',
    toolName,
    toolInput,
    toolOutput: toolResponse,
    isError,
    turnContext,
  }

  for (const matcher of matchers) {
    if (matcher.toolName && !matcher.toolName.test(toolName)) {
      continue
    }

    try {
      await matcher.callback(input)
    } catch (err) {
      console.error(
        `[sena][codex] PostToolUse hook error for tool "${toolName}":`,
        err,
      )
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function buildTurnContext(turnId: string, sessionId: string, cwd: string): TurnContext {
  return {
    turnId,
    agentName: 'codex',
    trigger: 'programmatic' as const,
    input: '',
    sessionId,
    metadata: { cwd },
  }
}
