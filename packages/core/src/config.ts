import type { SenaConfig } from './types.js'

export type ResolvedSenaConfig = Required<Pick<SenaConfig, 'name' | 'runtime' | 'connectors' | 'tools' | 'schedules'>> & {
  hooks: NonNullable<SenaConfig['hooks']>
  orchestrator?: SenaConfig['orchestrator']
}

export function defineConfig(config: SenaConfig): ResolvedSenaConfig {
  return {
    name: config.name,
    runtime: config.runtime,
    connectors: config.connectors ?? [],
    tools: config.tools ?? [],
    hooks: config.hooks ?? {},
    schedules: config.schedules ?? [],
    orchestrator: config.orchestrator,
  }
}
