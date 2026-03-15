import type { Runtime, RuntimeEvent, TurnStartHook, TurnEndHook, TurnContext, ContextFragment, TurnResult } from '../types.js'

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
