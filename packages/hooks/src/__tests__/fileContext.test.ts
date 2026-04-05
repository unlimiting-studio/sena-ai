import { describe, it, expect } from 'vitest'
import { fileContextHook } from '../fileContext.js'
import type { TurnContext, TurnStartInput, ContextFragment } from '@sena-ai/core'
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

function getFragments(result: { decision: string; fragments?: ContextFragment[] }): ContextFragment[] {
  return 'fragments' in result ? result.fragments ?? [] : []
}

describe('fileContextHook', () => {
  it('loads a single file and returns fragments with correct role', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    const fragments = getFragments(result)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].role).toBe('system')
    expect(fragments[0].content).toContain('테스트 에이전트')
    expect(fragments[0].source).toBe('file:soul.md')
  })

  it('loads directory with glob filter', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'memory'),
      as: 'append',
      glob: '*.md',
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    const fragments = getFragments(result)
    expect(fragments.length).toBeGreaterThan(0)
    expect(fragments.every(f => f.role === 'append')).toBe(true)
    // .txt files should be excluded by glob
    const allContent = fragments.map(f => f.content).join('\n')
    expect(allContent).not.toContain('무시')
  })

  it('respects prepend role', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'prepend',
    })
    const result = await callback(makeInput())

    const fragments = getFragments(result)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].role).toBe('prepend')
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
    const fragments = getFragments(result2)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].content).toContain('테스트 에이전트')
  })

  it('respects maxLength', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      maxLength: 10,
    })
    const result = await callback(makeInput())

    expect(result.decision).toBe('allow')
    const fragments = getFragments(result)
    expect(fragments).toHaveLength(1)
    expect(fragments[0].content.length).toBeLessThanOrEqual(10)
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
      const fragments = getFragments(result)
      expect(fragments).toHaveLength(1)
      expect(fragments[0].content).toContain('Hello from RuntimeHooks')
    } finally {
      await rm(tmpDir, { recursive: true })
    }
  })

  it('returns decision allow without fragments when condition is false', async () => {
    const callback = fileContextHook({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      when: () => false,
    })

    const result = await callback(makeInput())

    expect(result).toEqual({ decision: 'allow' })
  })
})
