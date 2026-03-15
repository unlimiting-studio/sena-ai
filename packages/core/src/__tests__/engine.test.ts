import { describe, it, expect } from 'vitest'
import { createTurnEngine } from '../engine.js'
import { createMockRuntime, createMockHook, createSpyEndHook } from './helpers.js'
import type { ContextFragment } from '../types.js'

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
})
