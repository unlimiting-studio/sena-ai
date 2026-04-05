import { describe, it, expect, vi } from 'vitest'
import { adaptLegacyHooks } from '../runtime-hooks.js'
import type { RuntimeHooks, TurnStartInput, TurnEndInput, ErrorInput } from '../runtime-hooks.js'
import type { TurnStartHook, TurnEndHook, ErrorHook, TurnContext, TurnResult, ContextFragment } from '../types.js'

const makeTurnContext = (overrides?: Partial<TurnContext>): TurnContext => ({
  turnId: 'turn-1',
  agentName: 'test-agent',
  trigger: 'programmatic',
  input: 'hello',
  sessionId: null,
  metadata: {},
  ...overrides,
})

const makeTurnResult = (overrides?: Partial<TurnResult>): TurnResult => ({
  text: 'response',
  sessionId: null,
  durationMs: 100,
  toolCalls: [],
  ...overrides,
})

describe('adaptLegacyHooks()', () => {
  it('returns empty hooks for empty input', () => {
    const hooks = adaptLegacyHooks({})
    expect(hooks.onTurnStart).toBeUndefined()
    expect(hooks.onTurnEnd).toBeUndefined()
    expect(hooks.onError).toBeUndefined()
  })

  it('converts TurnStartHook to onTurnStart', async () => {
    const fragments: ContextFragment[] = [
      { source: 'test', role: 'system', content: 'system prompt' },
      { source: 'test', role: 'prepend', content: 'prepend content' },
    ]
    const legacyHook: TurnStartHook = {
      name: 'my-hook',
      execute: vi.fn().mockResolvedValue(fragments),
    }

    const hooks = adaptLegacyHooks({ onTurnStart: [legacyHook] })

    expect(hooks.onTurnStart).toHaveLength(1)

    const input: TurnStartInput = {
      hookEventName: 'turnStart',
      prompt: 'hello',
      turnContext: makeTurnContext(),
    }
    const result = await hooks.onTurnStart![0](input)

    expect(legacyHook.execute).toHaveBeenCalledWith(input.turnContext)
    expect(result).toEqual({
      decision: 'allow',
      additionalContext: 'system prompt\nprepend content',
    })
  })

  it('TurnStartHook with empty fragments returns allow without additionalContext', async () => {
    const legacyHook: TurnStartHook = {
      name: 'empty-hook',
      execute: vi.fn().mockResolvedValue([]),
    }

    const hooks = adaptLegacyHooks({ onTurnStart: [legacyHook] })
    const input: TurnStartInput = {
      hookEventName: 'turnStart',
      prompt: 'hello',
      turnContext: makeTurnContext(),
    }
    const result = await hooks.onTurnStart![0](input)

    expect(result).toEqual({ decision: 'allow' })
  })

  it('converts TurnEndHook to onTurnEnd', async () => {
    const turnResult = makeTurnResult({ text: 'done', durationMs: 200 })
    const legacyHook: TurnEndHook = {
      name: 'end-hook',
      execute: vi.fn().mockResolvedValue(undefined),
    }

    const hooks = adaptLegacyHooks({ onTurnEnd: [legacyHook] })

    expect(hooks.onTurnEnd).toHaveLength(1)

    const input: TurnEndInput = {
      hookEventName: 'turnEnd',
      result: turnResult,
      turnContext: makeTurnContext(),
    }
    await hooks.onTurnEnd![0](input)

    expect(legacyHook.execute).toHaveBeenCalledWith(input.turnContext, turnResult)
  })

  it('converts ErrorHook to onError', async () => {
    const error = new Error('something broke')
    const legacyHook: ErrorHook = {
      name: 'error-hook',
      execute: vi.fn().mockResolvedValue(undefined),
    }

    const hooks = adaptLegacyHooks({ onError: [legacyHook] })

    expect(hooks.onError).toHaveLength(1)

    const input: ErrorInput = {
      hookEventName: 'error',
      error,
      turnContext: makeTurnContext(),
    }
    await hooks.onError![0](input)

    expect(legacyHook.execute).toHaveBeenCalledWith(input.turnContext, error)
  })

  it('merges with existing RuntimeHooks', async () => {
    const existingCallback = vi.fn().mockResolvedValue({ decision: 'allow' as const })
    const existing: RuntimeHooks = {
      onTurnStart: [existingCallback],
    }

    const legacyHook: TurnStartHook = {
      name: 'legacy',
      execute: vi.fn().mockResolvedValue([]),
    }

    const hooks = adaptLegacyHooks({ onTurnStart: [legacyHook] }, existing)

    // Legacy hooks come first, existing hooks come after
    expect(hooks.onTurnStart).toHaveLength(2)
    expect(hooks.onTurnStart![1]).toBe(existingCallback)
  })

  it('emits deprecation warnings when legacy hooks are adapted (AC-12)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const legacyStart: TurnStartHook = { name: 'start', execute: vi.fn().mockResolvedValue([]) }
    const legacyEnd: TurnEndHook = { name: 'end', execute: vi.fn().mockResolvedValue(undefined) }
    const legacyError: ErrorHook = { name: 'err', execute: vi.fn().mockResolvedValue(undefined) }

    adaptLegacyHooks({
      onTurnStart: [legacyStart],
      onTurnEnd: [legacyEnd],
      onError: [legacyError],
    })

    expect(warnSpy).toHaveBeenCalledTimes(3)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onTurnStart hooks are deprecated'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onTurnEnd hooks are deprecated'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('onError hooks are deprecated'))

    warnSpy.mockRestore()
  })

  it('preserves existing hooks on fields not covered by legacy', () => {
    const existingErrorCallback = vi.fn().mockResolvedValue(undefined)
    const existing: RuntimeHooks = {
      onError: [existingErrorCallback],
    }

    const legacyHook: TurnStartHook = {
      name: 'legacy-start',
      execute: vi.fn().mockResolvedValue([]),
    }

    const hooks = adaptLegacyHooks({ onTurnStart: [legacyHook] }, existing)

    expect(hooks.onTurnStart).toHaveLength(1)
    expect(hooks.onError).toHaveLength(1)
    expect(hooks.onError![0]).toBe(existingErrorCallback)
  })
})
