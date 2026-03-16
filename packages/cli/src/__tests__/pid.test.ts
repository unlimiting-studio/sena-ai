import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { isProcessAlive, readPid, removePid, writePid } from '../pid.js'

describe('pid helpers', () => {
  it('writes, reads, and removes the pid file in the current directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sena-pid-'))
    const previousCwd = process.cwd()
    process.chdir(dir)

    try {
      writePid(process.pid)
      expect(readPid()).toBe(process.pid)
      expect(isProcessAlive(process.pid)).toBe(true)

      removePid()
      expect(readPid()).toBeNull()
    } finally {
      process.chdir(previousCwd)
    }
  })
})
