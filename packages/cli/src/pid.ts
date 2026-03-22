import { resolve } from 'node:path'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { createConnection } from 'node:net'

const PID_FILE = () => resolve(process.cwd(), '.sena.pid')

export function writePid(pid: number): void {
  writeFileSync(PID_FILE(), String(pid), 'utf-8')
}

export function readPid(): number | null {
  try {
    const content = readFileSync(PID_FILE(), 'utf-8').trim()
    const pid = parseInt(content, 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

export function removePid(): void {
  try {
    unlinkSync(PID_FILE())
  } catch {
    // Ignore if file doesn't exist
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Check if a port is currently bound by attempting a TCP connection */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

/** Wait until a port is free, polling at the given interval */
export async function waitForPortFree(port: number, timeoutMs = 10_000, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortInUse(port))) return true
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}
