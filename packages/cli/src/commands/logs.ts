import type { Command } from 'commander'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

export function registerLogs(program: Command): void {
  program
    .command('logs')
    .description('Show Sena agent logs')
    .option('-f, --follow', 'follow log output (default: true)', true)
    .option('--no-follow', 'do not follow log output')
    .option('-n, --lines <n>', 'number of lines to show', '50')
    .action((opts: { follow: boolean; lines: string }) => {
      const logPath = resolve(process.cwd(), 'sena.log')

      if (!existsSync(logPath)) {
        console.log('No log file found (sena.log)')
        return
      }

      const args = ['-n', opts.lines]
      if (opts.follow) {
        args.push('-f')
      }
      args.push(logPath)

      const tail = spawn('tail', args, {
        stdio: ['ignore', 'inherit', 'inherit'],
      })

      process.on('SIGINT', () => {
        tail.kill()
        process.exit(0)
      })

      tail.on('exit', (code) => {
        process.exit(code ?? 0)
      })
    })
}
