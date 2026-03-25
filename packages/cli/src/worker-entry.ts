import 'dotenv/config'
import { createWorker } from '@sena-ai/core'

// Register disconnect handler early — before async config loading —
// so that if the orchestrator dies during boot we don't become an
// unmanaged orphan.
let earlyDisconnected = false
process.on('disconnect', () => {
  earlyDisconnected = true
  console.log('[worker-entry] orchestrator disconnected during boot, will exit')
  process.exit(1)
})

const configPath = process.env.SENA_CONFIG_PATH
if (!configPath) {
  console.error('SENA_CONFIG_PATH environment variable is required')
  process.exit(1)
}

// Use tsx tsImport for .ts config files (plain import won't work from compiled .js)
let config: Parameters<typeof createWorker>[0]['config']
if (configPath.endsWith('.ts') || configPath.endsWith('.tsx')) {
  const { tsImport } = await import('tsx/esm/api')
  const mod = await tsImport(configPath, import.meta.url) as { default: typeof config }
  config = mod.default
} else {
  const mod = await import(configPath) as { default: typeof config }
  config = mod.default
}

const port = parseInt(process.env.SENA_WORKER_PORT || '0', 10)

const worker = createWorker({ config, port })
worker.start()
