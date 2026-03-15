import { describe, it, expect } from 'vitest'
import { createWorker } from '../worker.js'
import { defineConfig } from '../config.js'
import type { Runtime, RuntimeEvent } from '../types.js'

const mockRuntime: Runtime = {
  name: 'mock',
  async *createStream(): AsyncGenerator<RuntimeEvent> {
    yield { type: 'session.init', sessionId: 'sess-1' }
    yield { type: 'result', text: 'hello from worker' }
  },
}

describe('createWorker', () => {
  it('creates a worker with engine', () => {
    const config = defineConfig({
      name: 'test-worker',
      runtime: mockRuntime,
    })

    const worker = createWorker({ config, port: 0 })
    expect(worker).toBeDefined()
    expect(worker.engine).toBeDefined()
  })
})
