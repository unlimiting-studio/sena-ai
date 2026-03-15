import { describe, it, expect } from 'vitest'
import { defineConfig, createAgent } from '../index.js'
import { createMockRuntime } from './helpers.js'
import type { TurnStartHook, ContextFragment } from '../types.js'

function inlineContext(content: string, role: 'system' | 'context' = 'system'): TurnStartHook {
  return {
    name: 'inline',
    async execute() {
      return [{ source: 'inline', role, content }]
    },
  }
}

describe('E2E: defineConfig → createAgent → processTurn', () => {
  it('runs full pipeline with hooks and returns valid trace', async () => {
    const config = defineConfig({
      name: 'sena-test',
      runtime: createMockRuntime('안녕하세요!'),
      hooks: {
        onTurnStart: [
          inlineContext('당신은 세나입니다.', 'system'),
          inlineContext('오늘의 기억: 테스트 중', 'context'),
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

    // Hook traces
    expect(trace.hooks).toHaveLength(2)

    // Assembled context: system before context
    expect(trace.assembledContext).toContain('당신은 세나입니다.')
    expect(trace.assembledContext).toContain('오늘의 기억: 테스트 중')
    const sysIdx = trace.assembledContext.indexOf('세나')
    const ctxIdx = trace.assembledContext.indexOf('기억')
    expect(sysIdx).toBeLessThan(ctxIdx)

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
