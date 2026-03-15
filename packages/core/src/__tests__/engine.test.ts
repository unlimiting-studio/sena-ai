import { describe, it, expect } from 'vitest'
import { createTurnEngine } from '../engine.js'
import { createMockRuntime, createMockHook, createSpyEndHook, createStreamingMockRuntime, createSpyErrorHook } from './helpers.js'
import type { ContextFragment, RuntimeEvent } from '../types.js'

describe('TurnEngine', () => {
  it('executes a basic turn and returns a TurnTrace', async () => {
    const engine = createTurnEngine({
      name: 'test',
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
      runtime: createMockRuntime(),
      hooks: {
        onTurnStart: [
          createMockHook('hook-a', [{ source: 'a', role: 'system', content: 'AAA' }]),
          createMockHook('hook-b', [{ source: 'b', role: 'context', content: 'BBB' }]),
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
      runtime: delayedRuntime,
      hooks: {},
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'stop', abortSignal: controller.signal })

    expect(trace.error).toBe('Aborted')
    expect(trace.result).toBeNull()
  })
})
