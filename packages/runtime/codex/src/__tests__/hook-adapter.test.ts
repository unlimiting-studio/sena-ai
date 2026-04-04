import { describe, it, expect, vi } from 'vitest'
import { evaluatePreToolUse, evaluatePostToolUse } from '../hook-adapter.js'
import type { RuntimeHooks, PreToolUseInput, PostToolUseInput } from '@sena-ai/core'

const BASE_ARGS = {
  toolInput: { command: 'ls' },
  toolUseId: 'tu_1',
  sessionId: 'sess_1',
  cwd: '/tmp',
} as const

// ─── evaluatePreToolUse ────────────────────────────────────────────

describe('evaluatePreToolUse', () => {
  it('returns allow when there are no hooks', async () => {
    const hooks: RuntimeHooks = {}
    const result = await evaluatePreToolUse(hooks, 'shell:ls', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'allow' })
  })

  it('returns deny when a hook denies', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [
        {
          callback: async () => ({ decision: 'deny' as const, reason: 'blocked by policy' }),
        },
      ],
    }
    const result = await evaluatePreToolUse(hooks, 'shell:rm -rf /', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'deny', reason: 'blocked by policy' })
  })

  it('skips hook when matcher does not match tool name', async () => {
    const callback = vi.fn(async () => ({ decision: 'deny' as const, reason: 'nope' }))
    const hooks: RuntimeHooks = {
      onPreToolUse: [
        {
          toolName: /^file:/,
          callback,
        },
      ],
    }
    const result = await evaluatePreToolUse(hooks, 'shell:ls', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'allow' })
    expect(callback).not.toHaveBeenCalled()
  })

  it('logs warning and returns plain allow when updatedInput is returned', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onPreToolUse: [
        {
          callback: async () => ({
            decision: 'allow' as const,
            updatedInput: { command: 'echo safe' },
          }),
        },
      ],
    }
    const result = await evaluatePreToolUse(hooks, 'shell:dangerous', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'allow' })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('updatedInput'),
    )
    warnSpy.mockRestore()
  })

  it('isolates errors — returns allow when a hook throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onPreToolUse: [
        {
          callback: async () => { throw new Error('boom') },
        },
      ],
    }
    const result = await evaluatePreToolUse(hooks, 'shell:ls', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'allow' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('returns deny when first hook passes and second denies', async () => {
    const hooks: RuntimeHooks = {
      onPreToolUse: [
        {
          callback: async () => ({ decision: 'pass' as const }),
        },
        {
          callback: async () => ({ decision: 'deny' as const, reason: 'second hook says no' }),
        },
      ],
    }
    const result = await evaluatePreToolUse(hooks, 'shell:rm', BASE_ARGS.toolInput, BASE_ARGS.toolUseId, BASE_ARGS.sessionId, BASE_ARGS.cwd)
    expect(result).toEqual({ decision: 'deny', reason: 'second hook says no' })
  })

  it('passes correct input shape to callback', async () => {
    const callback = vi.fn(async (_input: PreToolUseInput) => ({ decision: 'allow' as const }))
    const hooks: RuntimeHooks = {
      onPreToolUse: [{ callback }],
    }
    await evaluatePreToolUse(hooks, 'mcp:server/tool', { arg: 'val' }, 'tu_x', 'sess_x', '/home')
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        hookEventName: 'preToolUse',
        toolName: 'mcp:server/tool',
        toolInput: { arg: 'val' },
        turnContext: expect.objectContaining({
          turnId: 'tu_x',
          sessionId: 'sess_x',
          metadata: { cwd: '/home' },
        }),
      }),
    )
  })
})

// ─── evaluatePostToolUse ───────────────────────────────────────────

describe('evaluatePostToolUse', () => {
  it('calls matching hooks with correct input', async () => {
    const callback = vi.fn(async (_input: PostToolUseInput) => {})
    const hooks: RuntimeHooks = {
      onPostToolUse: [
        {
          toolName: /^shell:/,
          callback,
        },
      ],
    }
    await evaluatePostToolUse(hooks, 'shell:ls', { command: 'ls' }, 'file list output', false, 'tu_1', 'sess_1', '/tmp')
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        hookEventName: 'postToolUse',
        toolName: 'shell:ls',
        toolInput: { command: 'ls' },
        toolOutput: 'file list output',
        isError: false,
      }),
    )
  })

  it('does not crash when a hook throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hooks: RuntimeHooks = {
      onPostToolUse: [
        {
          callback: async () => { throw new Error('post hook boom') },
        },
      ],
    }
    await expect(
      evaluatePostToolUse(hooks, 'shell:ls', {}, 'output', false, 'tu_1', 'sess_1', '/tmp'),
    ).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('ignores additionalContext returned by hook — Codex limitation (AC-06)', async () => {
    const callback = vi.fn(async () => ({ additionalContext: 'extra info' }))
    const hooks: RuntimeHooks = {
      onPostToolUse: [{ callback }],
    }
    // evaluatePostToolUse returns void — additionalContext from the hook is intentionally ignored
    const result = await evaluatePostToolUse(hooks, 'shell:ls', { command: 'ls' }, 'output', false, 'tu_1', 'sess_1', '/tmp')
    expect(result).toBeUndefined()
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
