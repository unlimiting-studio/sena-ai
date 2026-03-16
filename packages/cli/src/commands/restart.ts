import type { Command } from 'commander'
import { readPid, isProcessAlive } from '../pid.js'

export function registerRestart(program: Command): void {
  program
    .command('restart')
    .description('Restart the Sena agent')
    .option('--full', 'full restart (stop + start in daemon mode)')
    .option('-c, --config <path>', 'path to sena.config.ts')
    .action(async (opts: { full?: boolean; config?: string }) => {
      if (opts.full) {
        await fullRestart(program, opts.config)
      } else {
        await workerRestart()
      }
    })
}

async function workerRestart(): Promise<void> {
  const pid = readPid()

  if (pid === null) {
    console.error('No running sena process found')
    process.exit(1)
  }

  if (!isProcessAlive(pid)) {
    console.error(`Process (PID: ${pid}) is not running`)
    process.exit(1)
  }

  process.kill(pid, 'SIGUSR2')
  console.log('Worker restart triggered')
}

async function fullRestart(program: Command, configPath?: string): Promise<void> {
  // Execute stop logic
  const pid = readPid()
  if (pid !== null && isProcessAlive(pid)) {
    // Reuse stop logic inline
    process.kill(pid, 'SIGTERM')
    console.log(`Sent SIGTERM to process ${pid}, waiting for shutdown...`)

    const maxWait = 10_000
    const interval = 100
    let waited = 0

    while (waited < maxWait) {
      await new Promise((r) => setTimeout(r, interval))
      waited += interval
      if (!isProcessAlive(pid)) break
    }

    if (isProcessAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // ignore
      }
    }

    const { removePid } = await import('../pid.js')
    removePid()
    console.log('Previous instance stopped')
  }

  // Start in daemon mode
  const { loadConfig } = await import('../config-loader.js')
  const globalConfig = program.opts().config as string | undefined
  const resolvedConfigPath = configPath ?? globalConfig

  // Simulate daemon start by importing and calling
  const { spawn } = await import('node:child_process')
  const { openSync } = await import('node:fs')
  const { resolve, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { writePid } = await import('../pid.js')

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  const { port, configPath: absConfigPath } = await loadConfig(resolvedConfigPath)

  const cliPath = resolve(__dirname, '..', 'cli.js')
  const logPath = resolve(process.cwd(), 'sena.log')
  const logFd = openSync(logPath, 'a')

  const args = ['start']
  if (absConfigPath) {
    args.push('-c', absConfigPath)
  }

  const child = spawn(process.execPath, [cliPath, ...args], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, SENA_CONFIG_PATH: absConfigPath },
  })

  child.unref()

  if (child.pid) {
    console.log(`Full restart completed (new PID: ${child.pid}, port: ${port})`)
  } else {
    console.error('Failed to start new process')
    process.exit(1)
  }
}
