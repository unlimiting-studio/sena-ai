import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../config-loader.js'

const createdDirs: string[] = []

function createTempAgentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sena-cli-'))
  createdDirs.push(dir)
  return dir
}

describe('loadConfig', () => {
  afterEach(() => {
    delete process.env.SENA_PORT
  })

  it('loads sena.config.ts and .env from the current working directory', async () => {
    const dir = createTempAgentDir()
    mkdirSync(join(dir, '.sena'))
    writeFileSync(join(dir, '.env'), 'SENA_PORT=4567\n', 'utf-8')
    writeFileSync(
      join(dir, 'sena.config.ts'),
      [
        'export default {',
        "  name: 'test-agent',",
        '  orchestrator: { port: 1234 },',
        '}',
      ].join('\n'),
      'utf-8',
    )

    const previousCwd = process.cwd()
    process.chdir(dir)

    try {
      const result = await loadConfig()
      expect(result.config.name).toBe('test-agent')
      expect(result.port).toBe(1234)
      expect(realpathSync(result.configPath)).toBe(realpathSync(join(dir, 'sena.config.ts')))
    } finally {
      process.chdir(previousCwd)
    }
  })

  it('falls back to SENA_PORT when config port is missing', async () => {
    const dir = createTempAgentDir()
    writeFileSync(join(dir, '.env'), 'SENA_PORT=4567\n', 'utf-8')
    writeFileSync(
      join(dir, 'sena.config.ts'),
      [
        'export default {',
        "  name: 'port-from-env',",
        '}',
      ].join('\n'),
      'utf-8',
    )

    const previousCwd = process.cwd()
    process.chdir(dir)

    try {
      const result = await loadConfig()
      expect(result.port).toBe(4567)
    } finally {
      process.chdir(previousCwd)
    }
  })
})
