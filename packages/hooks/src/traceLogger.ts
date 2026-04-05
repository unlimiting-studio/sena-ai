import type { TurnEndCallback, TurnEndInput } from '@sena-ai/core'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type TraceLoggerOptions = {
  dir: string
  format?: 'json'
}

export function traceLoggerHook(options: TraceLoggerOptions): TurnEndCallback {
  const { dir } = options

  return async (input: TurnEndInput): Promise<void> => {
    await mkdir(dir, { recursive: true })

    const { turnContext, result } = input
    const filename = `${turnContext.turnId}-${Date.now()}.json`
    const trace = {
      turnId: turnContext.turnId,
      agentName: turnContext.agentName,
      trigger: turnContext.trigger,
      input: turnContext.input,
      timestamp: new Date().toISOString(),
      result,
    }

    await writeFile(join(dir, filename), JSON.stringify(trace, null, 2), 'utf-8')
  }
}
