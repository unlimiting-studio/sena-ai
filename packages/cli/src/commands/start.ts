import type { Command } from 'commander'
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { loadConfig } from '../config-loader.js'
import { writePid, removePid, readPid, isProcessAlive } from '../pid.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the Sena agent')
    .option('-d, --daemon', 'run in background (daemon mode)')
    .option('-c, --config <path>', 'path to sena.config.ts')
    .action(async (opts: { daemon?: boolean; config?: string }) => {
      ensureNoRunningProcess()

      const configPath = opts.config ?? program.opts().config as string | undefined
      const { port, configPath: resolvedConfigPath, config } = await loadConfig(configPath)

      // Set SENA_CONFIG_PATH so forked workers can find the config
      process.env.SENA_CONFIG_PATH = resolvedConfigPath

      const agentName = (config as Record<string, unknown>).name as string | undefined ?? 'default'

      if (opts.daemon) {
        await startDaemon(resolvedConfigPath, port, agentName)
      } else {
        await startForeground(resolvedConfigPath, port, agentName)
      }
    })
}

function ensureNoRunningProcess(): void {
  const pid = readPid()
  if (pid === null) {
    return
  }

  if (!isProcessAlive(pid)) {
    removePid()
    return
  }

  console.error(`Sena agent is already running (PID: ${pid})`)
  process.exit(1)
}

async function startDaemon(configPath: string, port: number, agentName: string): Promise<void> {
  const cliPath = resolve(__dirname, '..', 'cli.js')
  const logPath = resolve(process.cwd(), 'sena.log')
  const logFd = openSync(logPath, 'a')

  // Build args: start (without -d), preserving config path if provided
  const args = ['start']
  if (process.env.SENA_CONFIG_PATH) {
    args.push('-c', process.env.SENA_CONFIG_PATH)
  }

  const child = spawn(process.execPath, [cliPath, ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, SENA_CONFIG_PATH: configPath },
  })

  child.unref()

  if (child.pid) {
    console.log(`Sena agent '${agentName}' started in background (PID: ${child.pid}, port: ${port})`)
  } else {
    console.error('Failed to start daemon process')
    process.exit(1)
  }
}

async function startForeground(configPath: string, port: number, agentName: string): Promise<void> {
  const { createOrchestrator } = await import('@sena-ai/core')

  // Worker entry path (relative to dist/)
  const workerEntryPath = resolve(__dirname, '..', 'worker-entry.js')

  const orchestrator = createOrchestrator({
    port,
    workerScript: workerEntryPath,
  })

  await orchestrator.start()
  writePid(process.pid)

  console.log(`Sena agent '${agentName}' started on port ${port}`)

  // SIGUSR2 → graceful worker restart
  process.on('SIGUSR2', () => {
    console.log('Received SIGUSR2, restarting workers...')
    void orchestrator.restart()
  })

  // SIGINT/SIGTERM → graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...')
    await orchestrator.stop()
    removePid()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}
