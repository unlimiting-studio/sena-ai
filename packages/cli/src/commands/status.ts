import type { Command } from 'commander'
import { request } from 'node:http'
import { readPid, isProcessAlive, removePid } from '../pid.js'
import { loadConfig } from '../config-loader.js'

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show the status of the Sena agent')
    .option('-c, --config <path>', 'path to sena.config.ts')
    .action(async (opts: { config?: string }) => {
      const pid = readPid()

      if (pid === null || !isProcessAlive(pid)) {
        if (pid !== null) {
          removePid()
        }
        console.log('No running sena agent found')
        return
      }

      // Try to determine port from config / .env
      let port: number
      try {
        const configPath = opts.config ?? program.opts().config as string | undefined
        const result = await loadConfig(configPath)
        port = result.port
      } catch {
        port = parseInt(process.env.SENA_PORT || '3100', 10)
      }

      // Health check
      const healthy = await checkHealth(port)
      if (healthy) {
        console.log(`Sena agent running (PID: ${pid}, port: ${port})`)
      } else {
        console.log(`Sena agent process alive (PID: ${pid}) but not responding on port ${port}`)
      }
    })
}

function checkHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        resolve(res.statusCode === 200)
        res.resume()
      },
    )

    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })

    req.end()
  })
}
