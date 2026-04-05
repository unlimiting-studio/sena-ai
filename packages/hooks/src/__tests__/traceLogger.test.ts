import { describe, it, expect, afterEach } from 'vitest'
import { traceLoggerHook } from '../traceLogger.js'
import { readFile, rm, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { TurnContext, TurnResult, TurnEndInput } from '@sena-ai/core'

const testDir = join(tmpdir(), 'sena-trace-test-' + Date.now())

function mockContext(): TurnContext {
  return {
    turnId: 'turn-123',
    agentName: 'test',
    trigger: 'programmatic',
    input: 'hello',
    sessionId: null,
    metadata: {},
  }
}

function mockResult(): TurnResult {
  return {
    text: 'response',
    sessionId: 'sess-1',
    durationMs: 100,
    toolCalls: [],
  }
}

describe('traceLoggerHook', () => {
  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  it('writes trace as JSON file', async () => {
    await mkdir(testDir, { recursive: true })
    const callback = traceLoggerHook({ dir: testDir })

    const input: TurnEndInput = {
      hookEventName: 'turnEnd',
      turnContext: mockContext(),
      result: mockResult(),
    }
    await callback(input)

    const entries = await readdir(testDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatch(/turn-123.*\.json$/)

    const content = JSON.parse(await readFile(join(testDir, entries[0]), 'utf-8'))
    expect(content.turnId).toBe('turn-123')
    expect(content.result.text).toBe('response')
  })
})
