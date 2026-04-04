import { describe, it, expect } from 'vitest'
import { createAgent } from '../agent.js'
import { defineConfig } from '../config.js'
import { createMockRuntime } from './helpers.js'

describe('createAgent()', () => {
  it('creates an agent that can process turns', async () => {
    const config = defineConfig({
      name: 'test-bot',
      runtime: createMockRuntime('I am test-bot'),
      hooks: {
        onTurnStart: [
          {
            callback: async () => ({ decision: 'allow' as const, additionalContext: 'You are test-bot' }),
          },
        ],
      },
    })

    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: 'hello' })

    expect(trace.agentName).toBe('test-bot')
    expect(trace.result?.text).toBe('I am test-bot')
    // Note: onTurnStart hooks are now forwarded to the runtime, not assembled by the engine
  })
})
