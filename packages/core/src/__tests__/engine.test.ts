import { describe, it, expect, vi } from 'vitest'
import { createTurnEngine } from '../engine.js'
import { createMockRuntime, createStreamingMockRuntime, createHookCapturingRuntime } from './helpers.js'
import type { RuntimeEvent, RuntimeStreamOptions } from '../types.js'
import type { RuntimeHooks, TurnEndInput, ErrorInput } from '../runtime-hooks.js'

function createFailRuntime(message: string) {
  return {
    name: 'fail',
    async *createStream(): AsyncGenerator<never> {
      yield* []
      throw new Error(message)
    },
  }
}

describe('TurnEngine', () => {
  it('executes a basic turn and returns a TurnTrace', async () => {
    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('hello world'),
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'hi' })

    expect(trace.agentName).toBe('test')
    expect(trace.trigger).toBe('programmatic')
    expect(trace.input).toBe('hi')
    expect(trace.result?.text).toBe('hello world')
    expect(trace.result?.sessionId).toBe('sess-1')
    expect(trace.error).toBeNull()
  })

  it('passes hooks through to runtime via RuntimeStreamOptions', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onTurnStartCallback = vi.fn(async () => ({ decision: 'allow' as const }))
    const hooks: RuntimeHooks = {
      onTurnStart: [onTurnStartCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks,
      tools: [],
    })

    await engine.processTurn({ input: 'hello' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.hooks).toBeDefined()
    expect(capturedOptions!.hooks!.onTurnStart).toHaveLength(1)
    expect(capturedOptions!.hooks!.onTurnStart![0]).toBe(onTurnStartCallback)
  })

  it('records error in trace when runtime fails', async () => {
    const failRuntime = createFailRuntime('runtime exploded')

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'boom' })

    expect(trace.error).toBe('runtime exploded')
    expect(trace.result).toBeNull()
  })

  it('tracks tool calls from tool.start/tool.end events', async () => {
    const events: RuntimeEvent[] = [
      { type: 'session.init', sessionId: 'sess-tools' },
      { type: 'tool.start', toolName: 'shell:ls' },
      { type: 'tool.end', toolName: 'shell:ls', isError: false },
      { type: 'result', text: 'done' },
    ]

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createStreamingMockRuntime(events),
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'list files' })

    expect(trace.result).not.toBeNull()
    expect(trace.result!.toolCalls).toHaveLength(1)
    expect(trace.result!.toolCalls[0].toolName).toBe('shell:ls')
    expect(trace.result!.toolCalls[0].isError).toBe(false)
  })

  it('accumulates progress.delta as result fallback when result is empty', async () => {
    const events: RuntimeEvent[] = [
      { type: 'session.init', sessionId: 'sess-delta' },
      { type: 'progress.delta', text: 'hel' },
      { type: 'progress.delta', text: 'lo' },
      { type: 'result', text: '' },
    ]

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createStreamingMockRuntime(events),
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'stream' })

    expect(trace.result).not.toBeNull()
    expect(trace.result!.text).toBe('hello')
  })

  it('progress event replaces previous progress (not accumulates)', async () => {
    const events: RuntimeEvent[] = [
      { type: 'session.init', sessionId: 'sess-progress' },
      { type: 'progress', text: 'first' },
      { type: 'progress', text: 'second' },
      { type: 'result', text: '' },
    ]

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createStreamingMockRuntime(events),
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'progress' })

    expect(trace.result).not.toBeNull()
    expect(trace.result!.text).toBe('second')
  })

  it('onEvent callback receives all events', async () => {
    const events: RuntimeEvent[] = [
      { type: 'session.init', sessionId: 'sess-spy' },
      { type: 'progress', text: 'working...' },
      { type: 'tool.start', toolName: 'search' },
      { type: 'tool.end', toolName: 'search', isError: false },
      { type: 'result', text: 'found it' },
    ]

    const receivedEvents: RuntimeEvent[] = []
    const onEvent = (event: RuntimeEvent) => {
      receivedEvents.push(event)
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createStreamingMockRuntime(events),
      hooks: {},
      tools: [],
    })

    await engine.processTurn({ input: 'search', onEvent })

    expect(receivedEvents).toHaveLength(5)
    const types = receivedEvents.map(e => e.type)
    expect(types).toEqual(['session.init', 'progress', 'tool.start', 'tool.end', 'result'])
  })

  it('abort signal stops turn', async () => {
    const delayedRuntime = {
      name: 'delayed',
      async *createStream(options: { abortSignal: AbortSignal }): AsyncGenerator<RuntimeEvent> {
        if (options.abortSignal.aborted) {
          throw new Error('Aborted')
        }
        yield { type: 'session.init' as const, sessionId: 'sess-abort' }
        // Check abort before yielding result
        if (options.abortSignal.aborted) {
          throw new Error('Aborted')
        }
        yield { type: 'result' as const, text: 'should not reach' }
      },
    }

    const controller = new AbortController()
    controller.abort()

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: delayedRuntime,
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'stop', abortSignal: controller.signal })

    expect(trace.error).toBe('Aborted')
    expect(trace.result).toBeNull()
  })

  // === RuntimeHooks integration tests ===

  it('calls hooks.onTurnEnd after successful turn with correct TurnEndInput', async () => {
    const onTurnEndCallback = vi.fn()
    const hooks: RuntimeHooks = {
      onTurnEnd: [onTurnEndCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('hello world'),
      hooks,
      tools: [],
    })

    await engine.processTurn({ input: 'hi' })

    expect(onTurnEndCallback).toHaveBeenCalledTimes(1)
    const input: TurnEndInput = onTurnEndCallback.mock.calls[0][0]
    expect(input.hookEventName).toBe('turnEnd')
    expect(input.result.text).toBe('hello world')
    expect(input.turnContext.input).toBe('hi')
  })

  it('isolates hooks.onTurnEnd errors (hook throws but turn succeeds)', async () => {
    const throwingCallback = vi.fn().mockRejectedValue(new Error('hook exploded'))
    const hooks: RuntimeHooks = {
      onTurnEnd: [throwingCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('success'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'go' })

    // The turn should still succeed despite the hook error
    expect(trace.error).toBeNull()
    expect(trace.result).not.toBeNull()
    expect(trace.result!.text).toBe('success')
    expect(throwingCallback).toHaveBeenCalledTimes(1)
  })

  it('calls hooks.onError when runtime fails', async () => {
    const failRuntime = createFailRuntime('runtime broke')

    const onErrorCallback = vi.fn()
    const hooks: RuntimeHooks = {
      onError: [onErrorCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'fail' })

    expect(trace.error).toBe('runtime broke')
    expect(onErrorCallback).toHaveBeenCalledTimes(1)
    const input: ErrorInput = onErrorCallback.mock.calls[0][0]
    expect(input.hookEventName).toBe('error')
    expect(input.error.message).toBe('runtime broke')
  })

  it('passes onStop hooks through to runtime via hooks (AC-10)', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onStopCallback = vi.fn()
    const hooks: RuntimeHooks = {
      onStop: [onStopCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks,
      tools: [],
    })

    await engine.processTurn({ input: 'hi' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.hooks).toBeDefined()
    expect(capturedOptions!.hooks!.onStop).toHaveLength(1)
    expect(capturedOptions!.hooks!.onStop![0]).toBe(onStopCallback)
  })

  it('passes onTurnStart hooks through to runtime via hooks (AC-09)', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onTurnStartCallback = vi.fn(async () => ({ decision: 'block' as const, reason: 'denied' }))
    const hooks: RuntimeHooks = {
      onTurnStart: [onTurnStartCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks,
      tools: [],
    })

    await engine.processTurn({ input: 'hi' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.hooks).toBeDefined()
    expect(capturedOptions!.hooks!.onTurnStart).toHaveLength(1)
    expect(capturedOptions!.hooks!.onTurnStart![0]).toBe(onTurnStartCallback)
  })

  it('collects followUp from onTurnEnd hook into trace.followUps', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ followUp: 'do more work' })],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('initial response'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'hi' })

    expect(trace.followUps).toEqual([
      { prompt: 'do more work', fork: false, detached: false },
    ])
  })

  it('isolates hooks.onError errors', async () => {
    const failRuntime = createFailRuntime('runtime broke')

    const throwingErrorCallback = vi.fn().mockRejectedValue(new Error('error hook exploded'))
    const hooks: RuntimeHooks = {
      onError: [throwingErrorCallback],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks,
      tools: [],
    })

    // Should not throw despite the hook error
    const trace = await engine.processTurn({ input: 'fail' })

    expect(trace.error).toBe('runtime broke')
    expect(throwingErrorCallback).toHaveBeenCalledTimes(1)
  })
})
