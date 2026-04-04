import { describe, it, expect, vi } from 'vitest'
import { createTurnEngine } from '../engine.js'
import { createMockRuntime, createMockHook, createSpyEndHook, createStreamingMockRuntime, createSpyErrorHook, createHookCapturingRuntime } from './helpers.js'
import type { ContextFragment, RuntimeEvent, RuntimeStreamOptions } from '../types.js'
import type { RuntimeHooks, TurnEndInput, ErrorInput } from '../runtime-hooks.js'

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

  it('runs onTurnStart hooks and collects fragments', async () => {
    const fragments: ContextFragment[] = [
      { source: 'test:soul', role: 'system', content: 'You are a test agent' },
    ]

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime(),
      hooks: {
        onTurnStart: [createMockHook('soul-loader', fragments)],
      },
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'hello' })

    expect(trace.hooks).toHaveLength(1)
    expect(trace.hooks[0].name).toBe('soul-loader')
    expect(trace.hooks[0].fragments).toEqual(fragments)
    expect(trace.assembledContext).toContain('You are a test agent')
  })

  it('runs multiple onTurnStart hooks in order', async () => {
    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime(),
      hooks: {
        onTurnStart: [
          createMockHook('hook-a', [{ source: 'a', role: 'system', content: 'AAA' }]),
          createMockHook('hook-b', [{ source: 'b', role: 'append', content: 'BBB' }]),
        ],
      },
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'test' })

    expect(trace.hooks).toHaveLength(2)
    expect(trace.hooks[0].name).toBe('hook-a')
    expect(trace.hooks[1].name).toBe('hook-b')
    expect(trace.assembledContext).toMatch(/AAA[\s\S]*BBB/)
  })

  it('runs onTurnEnd hooks with result', async () => {
    const endHook = createSpyEndHook('logger')

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('done'),
      hooks: { onTurnEnd: [endHook] },
      tools: [],
    })

    await engine.processTurn({ input: 'go' })

    expect(endHook.calls).toHaveLength(1)
    expect(endHook.calls[0].result.text).toBe('done')
  })

  it('records error in trace when runtime fails', async () => {
    const failRuntime = {
      name: 'fail',
      async *createStream(): AsyncGenerator<never> {
        throw new Error('runtime exploded')
      },
    }

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

  it('onError hooks execute when runtime fails', async () => {
    const failRuntime = {
      name: 'fail',
      async *createStream(): AsyncGenerator<never> {
        throw new Error('kaboom')
      },
    }

    const errorHook = createSpyErrorHook('error-logger')

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks: { onError: [errorHook] },
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'fail' })

    expect(trace.error).toBe('kaboom')
    expect(errorHook.calls).toHaveLength(1)
    expect(errorHook.calls[0].error.message).toBe('kaboom')
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

  it('passes runtimeHooks through to runtime via RuntimeStreamOptions', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onTurnEndCallback = vi.fn()
    const runtimeHooks: RuntimeHooks = {
      onTurnEnd: [{ callback: onTurnEndCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    await engine.processTurn({ input: 'hi' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.runtimeHooks).toBeDefined()
    // The merged hooks should contain the onTurnEnd callback we provided
    expect(capturedOptions!.runtimeHooks!.onTurnEnd).toHaveLength(1)
  })

  it('calls runtimeHooks.onTurnEnd after successful turn with correct TurnEndInput', async () => {
    const onTurnEndCallback = vi.fn()
    const runtimeHooks: RuntimeHooks = {
      onTurnEnd: [{ callback: onTurnEndCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('hello world'),
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    await engine.processTurn({ input: 'hi' })

    expect(onTurnEndCallback).toHaveBeenCalledTimes(1)
    const input: TurnEndInput = onTurnEndCallback.mock.calls[0][0]
    expect(input.hookEventName).toBe('turnEnd')
    expect(input.result.text).toBe('hello world')
    expect(input.turnContext.input).toBe('hi')
  })

  it('calls both legacy hooks and runtimeHooks (merged)', async () => {
    const legacyEndHook = createSpyEndHook('legacy-end')
    const runtimeEndCallback = vi.fn()
    const runtimeHooks: RuntimeHooks = {
      onTurnEnd: [{ callback: runtimeEndCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('merged result'),
      hooks: { onTurnEnd: [legacyEndHook] },
      tools: [],
      runtimeHooks,
    })

    await engine.processTurn({ input: 'go' })

    // Legacy hook was called
    expect(legacyEndHook.calls).toHaveLength(1)
    expect(legacyEndHook.calls[0].result.text).toBe('merged result')

    // RuntimeHooks callback was also called (via merged hooks)
    expect(runtimeEndCallback).toHaveBeenCalledTimes(1)
    const input: TurnEndInput = runtimeEndCallback.mock.calls[0][0]
    expect(input.result.text).toBe('merged result')
  })

  it('isolates runtimeHooks.onTurnEnd errors (hook throws but turn succeeds)', async () => {
    const throwingCallback = vi.fn().mockRejectedValue(new Error('hook exploded'))
    const runtimeHooks: RuntimeHooks = {
      onTurnEnd: [{ callback: throwingCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('success'),
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    const trace = await engine.processTurn({ input: 'go' })

    // The turn should still succeed despite the hook error
    expect(trace.error).toBeNull()
    expect(trace.result).not.toBeNull()
    expect(trace.result!.text).toBe('success')
    expect(throwingCallback).toHaveBeenCalledTimes(1)
  })

  it('calls runtimeHooks.onError when runtime fails', async () => {
    const failRuntime = {
      name: 'fail',
      async *createStream(): AsyncGenerator<never> {
        throw new Error('runtime broke')
      },
    }

    const onErrorCallback = vi.fn()
    const runtimeHooks: RuntimeHooks = {
      onError: [{ callback: onErrorCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    const trace = await engine.processTurn({ input: 'fail' })

    expect(trace.error).toBe('runtime broke')
    expect(onErrorCallback).toHaveBeenCalledTimes(1)
    const input: ErrorInput = onErrorCallback.mock.calls[0][0]
    expect(input.hookEventName).toBe('error')
    expect(input.error.message).toBe('runtime broke')
  })

  it('passes onStop hooks through to runtime via runtimeHooks (AC-10)', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onStopCallback = vi.fn()
    const runtimeHooks: RuntimeHooks = {
      onStop: [{ callback: onStopCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    await engine.processTurn({ input: 'hi' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.runtimeHooks).toBeDefined()
    expect(capturedOptions!.runtimeHooks!.onStop).toHaveLength(1)
    expect(capturedOptions!.runtimeHooks!.onStop![0].callback).toBe(onStopCallback)
  })

  it('passes onTurnStart hooks through to runtime via runtimeHooks (AC-09)', async () => {
    let capturedOptions: RuntimeStreamOptions | null = null
    const onTurnStartCallback = vi.fn(async () => ({ decision: 'block' as const, reason: 'denied' }))
    const runtimeHooks: RuntimeHooks = {
      onTurnStart: [{ callback: onTurnStartCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createHookCapturingRuntime((opts) => { capturedOptions = opts }),
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    await engine.processTurn({ input: 'hi' })

    expect(capturedOptions).not.toBeNull()
    expect(capturedOptions!.runtimeHooks).toBeDefined()
    expect(capturedOptions!.runtimeHooks!.onTurnStart).toHaveLength(1)
    expect(capturedOptions!.runtimeHooks!.onTurnStart![0].callback).toBe(onTurnStartCallback)
  })

  it('isolates runtimeHooks.onError errors', async () => {
    const failRuntime = {
      name: 'fail',
      async *createStream(): AsyncGenerator<never> {
        throw new Error('runtime broke')
      },
    }

    const throwingErrorCallback = vi.fn().mockRejectedValue(new Error('error hook exploded'))
    const runtimeHooks: RuntimeHooks = {
      onError: [{ callback: throwingErrorCallback }],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: failRuntime,
      hooks: {},
      tools: [],
      runtimeHooks,
    })

    // Should not throw despite the hook error
    const trace = await engine.processTurn({ input: 'fail' })

    expect(trace.error).toBe('runtime broke')
    expect(throwingErrorCallback).toHaveBeenCalledTimes(1)
  })
})
