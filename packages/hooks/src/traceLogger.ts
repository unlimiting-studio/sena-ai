import type { TurnEndHook, TurnContext, TurnResult, SimpleHookMatcher, TurnEndCallback, TurnEndInput } from '@sena-ai/core'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type TraceLoggerOptions = {
  dir: string
  format?: 'json'
}

export function traceLogger(options: TraceLoggerOptions): TurnEndHook {
  const { dir } = options

  return {
    name: 'traceLogger',
    async execute(context: TurnContext, result: TurnResult): Promise<void> {
      await mkdir(dir, { recursive: true })

      const filename = `${context.turnId}-${Date.now()}.json`
      const trace = {
        turnId: context.turnId,
        agentName: context.agentName,
        trigger: context.trigger,
        input: context.input,
        timestamp: new Date().toISOString(),
        result,
      }

      await writeFile(join(dir, filename), JSON.stringify(trace, null, 2), 'utf-8')
    },
  }
}

export function traceLoggerHook(options: TraceLoggerOptions): SimpleHookMatcher<TurnEndCallback> {
  const legacyHook = traceLogger(options)
  return {
    callback: async (input: TurnEndInput): Promise<void> => {
      await legacyHook.execute(input.turnContext, input.result)
    },
  }
}
