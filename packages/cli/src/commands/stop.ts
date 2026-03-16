import type { Command } from 'commander'
import { readPid, removePid, isProcessAlive } from '../pid.js'

export function registerStop(program: Command): void {
  program
    .command('stop')
    .description('Stop the running Sena agent')
    .action(async () => {
      const pid = readPid()

      if (pid === null) {
        console.log('No running sena process found')
        return
      }

      if (!isProcessAlive(pid)) {
        removePid()
        console.log(`Process (PID: ${pid}) not running, cleaned up stale PID file`)
        return
      }

      // Send SIGTERM for graceful shutdown
      process.kill(pid, 'SIGTERM')
      console.log(`Sent SIGTERM to process ${pid}, waiting for shutdown...`)

      // Wait up to 10 seconds
      const maxWait = 10_000
      const interval = 100
      let waited = 0

      while (waited < maxWait) {
        await new Promise((r) => setTimeout(r, interval))
        waited += interval
        if (!isProcessAlive(pid)) {
          removePid()
          console.log('Sena agent stopped')
          return
        }
      }

      // Force kill if still alive
      console.log('Process did not stop gracefully, sending SIGKILL...')
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Process may have exited between check and kill
      }

      removePid()
      console.log('Sena agent stopped (forced)')
    })
}
