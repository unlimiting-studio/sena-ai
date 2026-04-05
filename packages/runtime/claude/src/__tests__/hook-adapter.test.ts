import { describe, it, expect, vi } from 'vitest'
import { buildSdkHooks, defaultSlackBlockHook } from '../hook-adapter.js'
import type {
  RuntimeHooks,
  PreToolUseInput,
  PostToolUseInput,
  TurnStartInput,
  StopInput,
  SessionStartInput,
  TurnContext,
} from '@sena-ai/core'

const stubCtx: TurnContext = { turnId: '', agentName: '', trigger: 'programmatic', input: '', sessionId: null, metadata: {} }

function makePreToolInput(toolName: string): PreToolUseInput {
  return { hookEventName: 'preToolUse', toolName, toolInput: { key: 'val' }, turnContext: stubCtx }
}

// Helper to invoke the first SDK hook callback in a matcher array
async function invokeFirst(matchers: any[], input: any = {}) {
  return matchers[0].hooks[0](input, undefined, { signal: new AbortController().signal })
}

// ─── PreToolUse ────────────────────────────────────────────────────

describe('buildSdkHooks — PreToolUse', () => {
  it('maps deny decision correctly', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({ decision: 'deny' as const, reason: 'not allowed' }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    expect(sdk.PreToolUse).toHaveLength(1)

    const result = await invokeFirst(sdk.PreToolUse!, { tool_name: 'Bash', tool_input: {} })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'not allowed',
      },
    })
  })

  it('maps allow decision correctly', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({ decision: 'allow' as const }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PreToolUse!, { tool_name: 'Read', tool_input: {} })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    })
  })

  it('maps allow with updatedInput', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({
          decision: 'allow' as const,
          updatedInput: { path: '/safe/path' },
        }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PreToolUse!, { tool_name: 'Read', tool_input: {} })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { path: '/safe/path' },
      },
    })
  })

  it('maps pass decision to empty object (passthrough)', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({ decision: 'pass' as const }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PreToolUse!, { tool_name: 'Read', tool_input: {} })
    expect(result).toEqual({})
  })

  it('applies toolName matcher from regex source', () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        toolName: /^Bash$/,
        callback: async () => ({ decision: 'allow' as const }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    expect(sdk.PreToolUse![0].matcher).toBe('^Bash$')
  })

  it('omits matcher when toolName regex is not set', () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({ decision: 'allow' as const }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    expect(sdk.PreToolUse![0].matcher).toBeUndefined()
  })
})

// ─── PostToolUse ───────────────────────────────────────────────────

describe('buildSdkHooks — PostToolUse', () => {
  it('maps result with additionalContext', async () => {
    const hooks: RuntimeHooks = {
      onPostToolUse: [{
        callback: async () => ({ additionalContext: 'extra info' }),
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PostToolUse!, { tool_name: 'Bash', tool_input: {}, tool_output: 'ok', is_error: false })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'extra info',
      },
    })
  })

  it('maps void result (no additionalContext)', async () => {
    const hooks: RuntimeHooks = {
      onPostToolUse: [{
        callback: async () => undefined,
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PostToolUse!, { tool_name: 'Bash', tool_input: {}, tool_output: 'ok', is_error: false })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
      },
    })
  })
})

// onTurnStart is handled by the engine directly — no SDK hook mapping needed.

// ─── Stop ──────────────────────────────────────────────────────────

describe('buildSdkHooks — Stop', () => {
  it('maps continueWith to block decision', async () => {
    const hooks: RuntimeHooks = {
      onStop: [
        async () => ({ continueWith: 'keep going' }),
      ],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.Stop!, { reason: 'endTurn' })
    expect(result).toEqual({ decision: 'block', reason: 'keep going' })
  })

  it('maps void (normal stop) to empty object', async () => {
    const hooks: RuntimeHooks = {
      onStop: [
        async () => undefined,
      ],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.Stop!, { reason: 'endTurn' })
    expect(result).toEqual({})
  })
})

// ─── SessionStart ──────────────────────────────────────────────────

describe('buildSdkHooks — SessionStart', () => {
  it('maps result with additionalContext', async () => {
    const hooks: RuntimeHooks = {
      onSessionStart: [
        async () => ({ additionalContext: 'session context' }),
      ],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.SessionStart!, { session_id: 'abc' })
    expect(result).toEqual({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'session context',
      },
    })
  })

  it('maps void result', async () => {
    const hooks: RuntimeHooks = {
      onSessionStart: [
        async () => undefined,
      ],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.SessionStart!, { session_id: 'abc' })
    expect(result).toEqual({
      hookSpecificOutput: { hookEventName: 'SessionStart' },
    })
  })
})

// ─── Error Isolation ───────────────────────────────────────────────

describe('buildSdkHooks — error isolation', () => {
  it('returns empty object and logs error when PreToolUse callback throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => { throw new Error('boom') },
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PreToolUse!, { tool_name: 'Bash', tool_input: {} })
    expect(result).toEqual({})
    expect(consoleSpy).toHaveBeenCalledWith(
      '[hook-adapter] PreToolUse hook error:',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('returns empty object when PostToolUse callback throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onPostToolUse: [{
        callback: async () => { throw new Error('boom') },
      }],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.PostToolUse!, { tool_name: 'X', tool_input: {}, tool_output: '', is_error: false })
    expect(result).toEqual({})
    consoleSpy.mockRestore()
  })

  it('returns empty object when Stop callback throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onStop: [
        async () => { throw new Error('boom') },
      ],
    }
    const sdk = buildSdkHooks(hooks)
    const result = await invokeFirst(sdk.Stop!, { reason: 'endTurn' })
    expect(result).toEqual({})
    consoleSpy.mockRestore()
  })
})

// ─── Empty hooks ───────────────────────────────────────────────────

describe('buildSdkHooks — empty input', () => {
  it('returns empty object for empty RuntimeHooks', () => {
    expect(buildSdkHooks({})).toEqual({})
  })
})

// ─── defaultSlackBlockHook ─────────────────────────────────────────

describe('defaultSlackBlockHook', () => {
  it('denies Slack integration tools', async () => {
    const result = await defaultSlackBlockHook(makePreToolInput('mcp__claude_ai_Slack__slack_send_message'))
    expect(result).toEqual({
      decision: 'deny',
      reason: expect.stringContaining('Slack'),
    })
  })

  it('passes through non-Slack tools', async () => {
    const result = await defaultSlackBlockHook(makePreToolInput('Bash'))
    expect(result).toEqual({ decision: 'pass' })
  })

  it('passes through tools with similar but non-matching names', async () => {
    const result = await defaultSlackBlockHook(makePreToolInput('mcp__my_slack__send'))
    expect(result).toEqual({ decision: 'pass' })
  })
})

// ─── defaultSlackBlockHook integration with buildSdkHooks ─────────

describe('defaultSlackBlockHook included in SDK hooks', () => {
  it('is prepended to PreToolUse when building SDK hooks with user hooks', async () => {
    const userHooks: RuntimeHooks = {
      onPreToolUse: [{
        callback: async () => ({ decision: 'allow' as const }),
      }],
    }
    const merged: RuntimeHooks = {
      ...userHooks,
      onPreToolUse: [
        { toolName: /^mcp__claude_ai_Slack__/, callback: defaultSlackBlockHook },
        ...(userHooks.onPreToolUse ?? []),
      ],
    }
    const sdk = buildSdkHooks(merged)

    // Should have 2 PreToolUse matchers: Slack block first, user hook second
    expect(sdk.PreToolUse).toHaveLength(2)
    expect(sdk.PreToolUse![0].matcher).toBe('^mcp__claude_ai_Slack__')

    // The Slack hook should deny Slack tools
    const denyResult = await invokeFirst([sdk.PreToolUse![0]], { tool_name: 'mcp__claude_ai_Slack__slack_send_message', tool_input: {} })
    expect(denyResult).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringContaining('Slack'),
      },
    })
  })

  it('is included even when no user hooks are provided', () => {
    const sdk = buildSdkHooks({
      onPreToolUse: [
        { toolName: /^mcp__claude_ai_Slack__/, callback: defaultSlackBlockHook },
      ],
    })
    expect(sdk.PreToolUse).toHaveLength(1)
    expect(sdk.PreToolUse![0].matcher).toBe('^mcp__claude_ai_Slack__')
  })
})
