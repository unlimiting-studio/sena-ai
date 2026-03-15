import type { ResolvedSenaConfig } from './config.js'
import { createTurnEngine, type ProcessTurnOptions } from './engine.js'
import type { TurnTrace } from './types.js'

export type Agent = {
  name: string
  processTurn(options: ProcessTurnOptions): Promise<TurnTrace>
}

export function createAgent(config: ResolvedSenaConfig): Agent {
  const engine = createTurnEngine({
    name: config.name,
    runtime: config.runtime,
    hooks: config.hooks,
    tools: config.tools,
  })

  return {
    name: config.name,
    processTurn: (options) => engine.processTurn(options),
  }
}
