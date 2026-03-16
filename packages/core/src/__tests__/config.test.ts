import { describe, it, expect } from 'vitest'
import { defineConfig } from '../config.js'
import { defineTool } from '../tool.js'
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

  it('throws on duplicate tool names', () => {
    const tool1 = defineTool({
      name: 'slack_get_messages',
      description: 'Get messages from Slack',
      handler: async () => [{ type: 'text', text: 'result' }],
    })

    const tool2 = defineTool({
      name: 'slack_get_messages',
      description: 'Another Slack tool',
      handler: async () => [{ type: 'text', text: 'result' }],
    })

    expect(() =>
      defineConfig({
        name: 'agent',
        runtime: mockRuntime,
        tools: [tool1, tool2],
      })
    ).toThrow('Duplicate tool name "slack_get_messages" — tool names must be unique across all tools.')
  })

  it('allows unique tool names', () => {
    const tool1 = defineTool({
      name: 'slack_get_messages',
      description: 'Get messages from Slack',
      handler: async () => [{ type: 'text', text: 'result' }],
    })

    const tool2 = defineTool({
      name: 'slack_post_message',
      description: 'Post message to Slack',
      handler: async () => [{ type: 'text', text: 'result' }],
    })

    const config = defineConfig({
      name: 'agent',
      runtime: mockRuntime,
      tools: [tool1, tool2],
    })

    expect(config.tools).toHaveLength(2)
    expect(config.tools[0].name).toBe('slack_get_messages')
    expect(config.tools[1].name).toBe('slack_post_message')
  })
})
