import { resolve } from 'node:path'
import dotenv from 'dotenv'

export type LoadConfigResult = {
  config: Record<string, unknown>
  port: number
  configPath: string
}

function unwrapConfigModule(mod: Record<string, unknown>): Record<string, unknown> {
  const first = (mod.default ?? mod) as Record<string, unknown>
  return (first.default ?? first) as Record<string, unknown>
}

/**
 * Dynamically import a TypeScript file using tsx's tsImport API.
 * Falls back to plain dynamic import for non-TS files or if tsx is unavailable.
 */
async function importTs(filePath: string): Promise<Record<string, unknown>> {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    try {
      const { tsImport } = await import('tsx/esm/api')
      const mod = await tsImport(filePath, import.meta.url) as Record<string, unknown>
      return unwrapConfigModule(mod)
    } catch {
      // Fall back to plain import (works if tsx is active via --import flag)
    }
  }
  const mod = await import(filePath) as Record<string, unknown>
  return unwrapConfigModule(mod)
}

export async function loadConfig(configPath?: string): Promise<LoadConfigResult> {
  const cwd = process.cwd()

  // 1. Load .env
  dotenv.config({ path: resolve(cwd, '.env'), override: true })

  // 2. Resolve config path
  const resolvedConfigPath = configPath
    ? resolve(cwd, configPath)
    : resolve(cwd, 'sena.config.ts')

  // 3. Dynamic import of user config (using tsx tsImport for .ts files)
  const config = await importTs(resolvedConfigPath)

  // 4. Resolve port
  const orchestrator = config.orchestrator as { port?: number } | undefined
  const port = orchestrator?.port
    ?? parseInt(process.env.SENA_PORT || '3100', 10)

  return { config, port, configPath: resolvedConfigPath }
}
