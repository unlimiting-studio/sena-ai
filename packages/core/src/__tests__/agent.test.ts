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
          async () => ({ decision: 'allow' as const, fragments: [{ source: 'test', role: 'system' as const, content: 'You are test-bot' }] }),
        ],
      },
    })

    const agent = createAgent(config)
    const trace = await agent.processTurn({ input: 'hello' })

    expect(trace.agentName).toBe('test-bot')
    expect(trace.result?.text).toBe('I am test-bot')
    // onTurnStart hooks are executed by the engine and fragments are assembled into context
  })
})
