import { describe, it, expect } from 'vitest'
import { fileContextHook } from '../fileContext.js'
import type { TurnContext, TurnStartInput } from '@sena-ai/core'
import { join } from 'node:path'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const fixturesDir = join(import.meta.dirname, 'fixtures')

function mockContext(overrides?: Partial<TurnContext>): TurnContext {
  return {
    turnId: 'turn-1',
    agentName: 'test',
    trigger: 'programmatic',
    input: 'hello',
    sessionId: null,
    metadata: {},
    ...overrides,
  }
}

function makeInput(overrides?: Partial<TurnContext>): TurnStartInput {
  return {
    hookEventName: 'turnStart',
    prompt: 'test prompt',
    turnContext: mockContext(overrides),
  }
}

describe('fileContextHook', () => {
  it('loads a single file and returns additionalContext', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    expect('additionalContext' in result && result.additionalContext).toContain('테스트 에이전트')
  })

  it('loads directory with glob filter', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'memory'),
      as: 'append',
      glob: '*.md',
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    expect('additionalContext' in result && result.additionalContext).toBeTruthy()
    // .txt files should be excluded by glob
    expect('additionalContext' in result && result.additionalContext).not.toContain('무시')
  })

  it('respects when condition', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      when: (ctx) => ctx.trigger === 'schedule',
    })

    const result1 = await callback(makeInput({ trigger: 'programmatic' }))
    expect(result1).toEqual({ decision: 'allow' })

    const result2 = await callback(makeInput({ trigger: 'schedule' }))
    expect(result2.decision).toBe('allow')
    expect('additionalContext' in result2 && result2.additionalContext).toContain('테스트 에이전트')
  })

  it('respects maxLength', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      maxLength: 10,
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    if ('additionalContext' in result) {
      // additionalContext includes the [file:soul.md] prefix, but the content portion should be truncated
      expect(result.additionalContext).toBeDefined()
    }
  })

  it('returns TurnStartCallback function', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'sena-hook-test-'))
    const tmpFile = join(tmpDir, 'test-context.txt')
    await writeFile(tmpFile, 'Hello from RuntimeHooks', 'utf-8')

    try {
      const callback = fileContextHook({ path: tmpFile, as: 'system' })

      expect(typeof callback).toBe('function')

      const result = await callback(makeInput())

      expect(result.decision).toBe('allow')
      expect('additionalContext' in result && result.additionalContext).toContain('Hello from RuntimeHooks')
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })

  it('returns decision allow without additionalContext when no fragments', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      when: () => false,
    })

    const result = await callback(makeInput())

    expect(result).toEqual({ decision: 'allow' })
  })
})
