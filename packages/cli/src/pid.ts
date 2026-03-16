import { resolve } from 'node:path'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'

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
