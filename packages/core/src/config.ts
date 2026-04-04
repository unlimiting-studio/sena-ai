import type { SenaConfig } from './types.js'

export type ResolvedSenaConfig = Required<Pick<SenaConfig, 'name' | 'runtime' | 'connectors' | 'tools' | 'schedules'>> & {
  cwd: string
  cwdConfigured: boolean
  hooks: NonNullable<SenaConfig['hooks']>
  orchestrator?: SenaConfig['orchestrator']
}

export function defineConfig(config: SenaConfig): ResolvedSenaConfig {
  // Validate tool name uniqueness
  const tools = config.tools ?? []
  const toolNames = new Set<string>()
  for (const tool of tools) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate tool name "${tool.name}" — tool names must be unique across all tools.`)
    }
    toolNames.add(tool.name)
  }

  return {
    name: config.name,
    cwd: config.cwd ?? process.cwd(),
    cwdConfigured: config.cwd !== undefined,
    runtime: config.runtime,
    connectors: config.connectors ?? [],
    tools,
    hooks: config.hooks ?? {},
    schedules: config.schedules ?? [],
    orchestrator: config.orchestrator,
  }
}
