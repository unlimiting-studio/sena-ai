import { describe, it, expect } from 'vitest'
import { defineConfig, createAgent } from '../index.js'
import { createMockRuntime } from './helpers.js'

describe('E2E: defineConfig → createAgent → processTurn', () => {
  it('runs full pipeline with hooks and returns valid trace', async () => {
    const config = defineConfig({
      name: 'sena-test',
      runtime: createMockRuntime('안녕하세요!'),
      hooks: {
        // RuntimeHooks format: onTurnStart hooks are forwarded to the runtime
        onTurnStart: [
          {
            callback: async () => ({ decision: 'allow' as const, additionalContext: '당신은 세나입니다.' }),
          },
        ],
      },
    })

    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: '안녕' })

    // Trace structure
    expect(trace.turnId).toBeDefined()
    expect(trace.agentName).toBe('sena-test')
    expect(trace.trigger).toBe('programmatic')
    expect(trace.input).toBe('안녕')

    // Result
    expect(trace.result?.text).toBe('안녕하세요!')
    expect(trace.result?.sessionId).toBe('sess-1')
    expect(trace.result?.durationMs).toBeGreaterThanOrEqual(0)
    expect(trace.error).toBeNull()
  })

  it('handles empty hooks gracefully', async () => {
    const config = defineConfig({
      name: 'minimal',
      runtime: createMockRuntime('ok'),
    })
    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: 'test' })

    expect(trace.hooks).toHaveLength(0)
    expect(trace.assembledContext).toBe('')
    expect(trace.result?.text).toBe('ok')
  })
})
