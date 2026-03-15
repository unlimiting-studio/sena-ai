import { describe, it, expect } from 'vitest'
import { defineConfig } from '../config.js'
import type { SenaConfig, Runtime } from '../types.js'

const mockRuntime: Runtime = {
  name: 'mock',
  async *createStream() {
    yield { type: 'result' as const, text: 'hello' }
  },
}

describe('defineConfig()', () => {
  it('returns config as-is with defaults applied', () => {
    const config = defineConfig({
      name: 'test-agent',
      runtime: mockRuntime,
    })
    expect(config.name).toBe('test-agent')
    expect(config.runtime.name).toBe('mock')
    expect(config.connectors).toEqual([])
    expect(config.tools).toEqual([])
    expect(config.hooks).toEqual({})
    expect(config.schedules).toEqual([])
  })

  it('preserves user-provided values', () => {
    const config = defineConfig({
      name: 'agent',
      runtime: mockRuntime,
      orchestrator: { port: 4000 },
    })
    expect(config.orchestrator?.port).toBe(4000)
  })
})
