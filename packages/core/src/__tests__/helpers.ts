import type { Runtime, RuntimeEvent, RuntimeStreamOptions } from '../types.js'

export function createMockRuntime(response: string = 'mock response'): Runtime {
  return {
    name: 'mock',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init', sessionId: 'sess-1' }
      yield { type: 'result', text: response }
    },
  }
}

export function createStreamingMockRuntime(events: RuntimeEvent[]): Runtime {
  return {
    name: 'mock-streaming',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      for (const event of events) {
        yield event
      }
    },
  }
}

/**
 * Creates a mock runtime that captures the RuntimeStreamOptions passed to createStream.
 * Useful for verifying that runtimeHooks and other options are forwarded correctly.
 */
export function createHookCapturingRuntime(
  onOptions: (opts: RuntimeStreamOptions) => void,
  response: string = 'mock response',
): Runtime {
  return {
    name: 'hook-capturing',
    async *createStream(options: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent> {
      onOptions(options)
      yield { type: 'session.init', sessionId: 'sess-capture' }
      yield { type: 'result', text: response }
    },
  }
}
