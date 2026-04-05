import { describe, it, expect } from 'vitest'
import { createTurnEngine } from '../engine.js'
import type { RuntimeHooks } from '../runtime-hooks.js'
import type { Runtime, RuntimeEvent, RuntimeStreamOptions } from '../types.js'

function createMockRuntime(response: string = 'mock response'): Runtime {
  return {
    name: 'mock',
    async *createStream(_options: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init' as const, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}` }
      yield { type: 'result' as const, text: response }
    },
  }
}

describe('Engine + Worker fork integration', () => {
  it('blocking followUp (no fork) produces a TurnFollowUp with fork=false', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ followUp: 'continue in same session' })],
    }
    const engine = createTurnEngine({
      name: 'test', cwd: '/tmp',
      runtime: createMockRuntime('first'), hooks, tools: [],
    })
    const trace = await engine.processTurn({ input: 'start' })
    expect(trace.followUps).toBeDefined()
    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'continue in same session',
      fork: false,
      detached: false,
    })
  })

  it('fork followUp produces a TurnFollowUp with fork=true', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, followUp: 'fork task' })],
    }
    const engine = createTurnEngine({
      name: 'test', cwd: '/tmp',
      runtime: createMockRuntime('original'), hooks, tools: [],
    })
    const trace = await engine.processTurn({ input: 'go' })
    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'fork task',
      fork: true,
      detached: false,
    })
  })

  it('fork+detached followUp produces correct TurnFollowUp', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, detached: true, followUp: 'silent task' })],
    }
    const engine = createTurnEngine({
      name: 'test', cwd: '/tmp',
      runtime: createMockRuntime('original'), hooks, tools: [],
    })
    const trace = await engine.processTurn({ input: 'go' })
    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'silent task',
      fork: true,
      detached: true,
    })
  })

  it('forked turn (metadata.forkedFrom set) downgrades fork to blocking', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, followUp: 'try nested fork' })],
    }
    const engine = createTurnEngine({
      name: 'test', cwd: '/tmp',
      runtime: createMockRuntime('forked response'), hooks, tools: [],
    })
    const trace = await engine.processTurn({
      input: 'from fork',
      metadata: { forkedFrom: 'parent-turn-123' },
    })
    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0].fork).toBe(false)
    expect(trace.followUps![0].detached).toBe(false)
  })
})
