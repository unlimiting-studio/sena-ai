import { describe, it, expect } from 'vitest'
import { fileContext } from '../fileContext.js'
import type { TurnContext } from '@sena-ai/core'
import { join } from 'node:path'

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

describe('fileContext', () => {
  it('loads a single file', async () => {
    const hook = fileContext({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
    })
    const fragments = await hook.execute(mockContext())

    expect(fragments).toHaveLength(1)
    expect(fragments[0].role).toBe('system')
    expect(fragments[0].content).toContain('테스트 에이전트')
    expect(fragments[0].source).toContain('soul.md')
  })

  it('loads directory with glob filter', async () => {
    const hook = fileContext({
      path: join(fixturesDir, 'memory'),
      as: 'context',
      glob: '*.md',
    })
    const fragments = await hook.execute(mockContext())

    expect(fragments).toHaveLength(2)
    expect(fragments.every(f => f.role === 'context')).toBe(true)
    expect(fragments.every(f => !f.content.includes('무시'))).toBe(true)
  })

  it('respects when condition', async () => {
    const hook = fileContext({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      when: (ctx) => ctx.trigger === 'schedule',
    })

    const fragments = await hook.execute(mockContext({ trigger: 'programmatic' }))
    expect(fragments).toHaveLength(0)

    const fragments2 = await hook.execute(mockContext({ trigger: 'schedule' }))
    expect(fragments2).toHaveLength(1)
  })

  it('respects maxLength', async () => {
    const hook = fileContext({
      path: join(fixturesDir, 'soul.md'),
      as: 'system',
      maxLength: 10,
    })
    const fragments = await hook.execute(mockContext())

    expect(fragments[0].content.length).toBeLessThanOrEqual(10)
  })
})
