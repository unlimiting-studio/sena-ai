import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineConfig, createAgent, env, createScheduler } from '../index.js'
import { createMockRuntime } from './helpers.js'
import type { RuntimeHooks, TurnEndInput, ErrorInput } from '../runtime-hooks.js'

// Simulate what a real sena.config.ts would look like
describe('Full sena.config.ts pattern', () => {
  it('works with the spec example pattern', async () => {
    const onTurnEndCallback = vi.fn()

    // This mirrors the spec example, using the unified RuntimeHooks format
    const config = defineConfig({
      name: '테스트-에이전트',

      runtime: createMockRuntime('안녕하세요, 저는 테스트 에이전트입니다.'),

      connectors: [], // No real connectors in test

      tools: [], // No real tools in test

      hooks: {
        onTurnEnd: [{ callback: onTurnEndCallback }],
      },

      schedules: [
        { name: '정각 알림', type: 'cron' as const, expression: '0 * * * *', prompt: '정각 체크' },
        { name: 'heartbeat', type: 'heartbeat' as const, expression: '15m', prompt: '하트비트 체크' },
      ],

      orchestrator: { port: 3100 },
    })

    // Verify config resolution
    expect(config.name).toBe('테스트-에이전트')
    expect(config.connectors).toEqual([])
    expect(config.tools).toEqual([])
    expect(config.hooks.onTurnEnd).toHaveLength(1)
    expect(config.schedules).toHaveLength(2)
    expect(config.orchestrator?.port).toBe(3100)

    // Create agent and process turn
    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: '안녕하세요' })

    // Verify full pipeline
    expect(trace.agentName).toBe('테스트-에이전트')
    expect(trace.trigger).toBe('programmatic')
    expect(trace.input).toBe('안녕하세요')

    // Verify result
    expect(trace.result?.text).toBe('안녕하세요, 저는 테스트 에이전트입니다.')
    expect(trace.result?.sessionId).toBe('sess-1')
    expect(trace.error).toBeNull()

    // Verify onTurnEnd hook was called
    expect(onTurnEndCallback).toHaveBeenCalledTimes(1)
    const turnEndInput: TurnEndInput = onTurnEndCallback.mock.calls[0][0]
    expect(turnEndInput.result.text).toBe('안녕하세요, 저는 테스트 에이전트입니다.')
  })

  it('works with schedule trigger', async () => {
    const config = defineConfig({
      name: 'scheduler-test',
      runtime: createMockRuntime('heartbeat ok'),
    })

    const agent = createAgent(config)
    const trace = await agent.processTurn({
      input: 'heartbeat check',
      trigger: 'schedule',
      schedule: { name: 'test-heartbeat', type: 'heartbeat' },
    })

    expect(trace.trigger).toBe('schedule')
    expect(trace.result?.text).toBe('heartbeat ok')
  })

  it('handles runtime errors gracefully', async () => {
    const failRuntime = {
      name: 'fail',
      async *createStream(): AsyncGenerator<never> {
        throw new Error('API key expired')
      },
    }

    const onErrorCallback = vi.fn()

    const config = defineConfig({
      name: 'error-test',
      runtime: failRuntime,
      hooks: {
        onError: [{ callback: onErrorCallback }],
      },
    })

    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: 'test' })

    expect(trace.error).toBe('API key expired')
    expect(trace.result).toBeNull()
    expect(onErrorCallback).toHaveBeenCalledTimes(1)
    const errorInput: ErrorInput = onErrorCallback.mock.calls[0][0]
    expect(errorInput.error.message).toBe('API key expired')
  })
})

describe('Scheduler integration', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('scheduler triggers turns on the agent', async () => {
    const turns: string[] = []

    const scheduler = createScheduler({
      schedules: [
        { name: 'fast', type: 'heartbeat', expression: '1s', prompt: 'heartbeat check' },
      ],
      onTurn: async (options) => {
        turns.push(options.input)
        return {
          turnId: 'turn-1', timestamp: new Date().toISOString(),
          agentName: 'test', trigger: 'schedule', input: options.input,
          hooks: [], assembledContext: '',
          result: { text: 'ok', sessionId: null, durationMs: 0, toolCalls: [] },
          error: null,
        }
      },
    })

    scheduler.start()
    await vi.advanceTimersByTimeAsync(3000)
    scheduler.stop()

    expect(turns.length).toBeGreaterThanOrEqual(2)
    expect(turns[0]).toBe('heartbeat check')
  })
})
