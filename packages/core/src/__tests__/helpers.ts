import type { Runtime, RuntimeEvent, RuntimeStreamOptions, TurnStartHook, TurnEndHook, ErrorHook, TurnContext, ContextFragment, TurnResult } from '../types.js'

export function createMockRuntime(response: string = 'mock response'): Runtime {
  return {
    name: 'mock',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init', sessionId: 'sess-1' }
      yield { type: 'result', text: response }
    },
  }
}

export function createMockHook(name: string, fragments: ContextFragment[]): TurnStartHook {
  return {
    name,
    async execute(_ctx: TurnContext) {
      return fragments
    },
  }
}

export function createSpyEndHook(name: string): TurnEndHook & { calls: { context: TurnContext; result: TurnResult }[] } {
  const hook = {
    name,
    calls: [] as { context: TurnContext; result: TurnResult }[],
    async execute(context: TurnContext, result: TurnResult) {
      hook.calls.push({ context, result })
    },
  }
  return hook
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

export function createSpyErrorHook(name: string): ErrorHook & { calls: { error: Error }[] } {
  const hook = {
    name,
    calls: [] as { error: Error }[],
    async execute(_ctx: TurnContext, error: Error) {
      hook.calls.push({ error })
    },
  }
  return hook
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
