import { describe, it, expect, vi } from 'vitest'
import { createSlackOutput, type SlackClientLike } from '../connector.js'

type PostMessageArgs = Parameters<SlackClientLike['chat']['postMessage']>[0]
type UpdateArgs = Parameters<SlackClientLike['chat']['update']>[0]
type DeleteArgs = Parameters<SlackClientLike['chat']['delete']>[0]

function getText(args: object): string {
  const value = Reflect.get(args, 'text')
  return typeof value === 'string' ? value : ''
}

function createSlackMock(overrides?: {
  update?: SlackClientLike['chat']['update']
  postMessage?: SlackClientLike['chat']['postMessage']
}) {
  const postCalls: PostMessageArgs[] = []
  const updateCalls: UpdateArgs[] = []
  const deleteCalls: DeleteArgs[] = []

  const defaultPostMessage: SlackClientLike['chat']['postMessage'] = async (args) => {
    postCalls.push(args)
    return { ok: true, ts: `ts-${postCalls.length}`, channel: 'C0AFW5Y133J' }
  }

  const defaultUpdate: SlackClientLike['chat']['update'] = async (args) => {
    updateCalls.push(args)
    return { ok: true, ts: String(args.ts ?? 'ts-1'), channel: 'C0AFW5Y133J' }
  }

  const defaultDelete: SlackClientLike['chat']['delete'] = async (args) => {
    deleteCalls.push(args)
    return { ok: true }
  }

  const slack: SlackClientLike = {
    chat: {
      postMessage: overrides?.postMessage ?? defaultPostMessage,
      update: overrides?.update ?? defaultUpdate,
      delete: defaultDelete,
    },
  }

  return { slack, postCalls, updateCalls, deleteCalls }
}

describe('createSlackOutput', () => {
  it('uses trigger-level thinkingMessage from metadata before the global default', async () => {
    const { slack, postCalls } = createSlackMock()

    createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: { thinkingMessage: '트리거별 메시지' },
      },
      '전역 메시지',
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(postCalls).toHaveLength(1)
    expect(getText(postCalls[0])).toBe('트리거별 메시지')
  })

  it('suppresses the global thinkingMessage when metadata sets it to false', async () => {
    const { slack, postCalls } = createSlackMock()

    createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: { thinkingMessage: false },
      },
      '전역 메시지',
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(postCalls).toHaveLength(0)
  })

  it('flushes the latest throttled progress after the throttle window even if no new delta arrives', async () => {
    vi.useFakeTimers()

    try {
      const { slack, postCalls, updateCalls } = createSlackMock()
      const output = createSlackOutput(
        slack,
        { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
        ':loading-dots: 브렌이 생각 중이에요',
      )

      await Promise.resolve()
      await Promise.resolve()

      expect(postCalls).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1600)
      await output.showProgress('her')

      expect(updateCalls).toHaveLength(1)
      expect(getText(updateCalls[0])).toBe('her')

      await output.showProgress('hero')
      expect(updateCalls).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(1500)

      expect(updateCalls).toHaveLength(2)
      expect(getText(updateCalls[1])).toBe('hero')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps oversized live progress in one message instead of posting duplicate thread messages', async () => {
    const { slack, postCalls, updateCalls } = createSlackMock()
    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    const longA = 'A'.repeat(3200)
    const longB = 'B'.repeat(3600)
    const longC = 'C'.repeat(4000)

    await Promise.all([
      output.showProgress(longA),
      output.showProgress(longB),
      output.showProgress(longC),
    ])

    expect(postCalls).toHaveLength(1)
    expect(updateCalls).toHaveLength(1)
    expect(getText(updateCalls[0])).toContain('계속 생성 중')
  })

  it('replaces the last growing preview with the final answer instead of duplicating both', async () => {
    const { slack, updateCalls } = createSlackMock()

    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    await output.showProgress('설정 스펙을 정리하는 중')
    await output.showProgress('설정 스펙을 정리하는 중이고, 중복 전송 원인을 보고 있어요')
    await output.sendResult('설정 스펙을 정리하는 중이고, 중복 전송 원인을 보고 있어요. 이제 같은 내용이 여러 번 나가지 않게 고쳤어요.')

    const lastUpdate = getText(updateCalls[updateCalls.length - 1])
    expect(lastUpdate).not.toContain('설정 스펙을 정리하는 중이고, 중복 전송 원인을 보고 있어요\n설정 스펙을 정리하는 중이고, 중복 전송 원인을 보고 있어요')
  })

  it('separates accumulated agent outputs with a blank line', async () => {
    const { slack, updateCalls } = createSlackMock()

    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    await output.showProgress('첫 번째 출력')
    await output.sendResult('두 번째 출력')

    const lastUpdate = getText(updateCalls[updateCalls.length - 1])
    expect(lastUpdate).toContain('첫 번째 출력\n\n두 번째 출력')
  })

  it('splits a long final answer into non-overlapping continuation messages', async () => {
    const { slack, postCalls, updateCalls } = createSlackMock({
      update: vi.fn(async (args) => {
        updateCalls.push(args)
        const text = String(args.text ?? '')
        if (text.length > 2800) {
          throw new Error('An API error occurred: msg_too_long')
        }
        return { ok: true, ts: String(args.ts ?? 'ts-1'), channel: 'C0AFW5Y133J' }
      }),
    })

    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    const preview = '설명 '.repeat(850)
    const longText = '설명 '.repeat(1400)

    await output.showProgress(preview)
    await output.sendResult(longText)

    expect(postCalls).toHaveLength(2)
    expect(updateCalls).toHaveLength(2)

    const firstChunk = getText(updateCalls[updateCalls.length - 1])
    const secondChunk = getText(postCalls[postCalls.length - 1])

    expect(firstChunk.length).toBeLessThanOrEqual(2600)
    expect(secondChunk.length).toBeLessThanOrEqual(2600)
    expect(firstChunk).not.toBe(secondChunk)
    expect(longText.startsWith(firstChunk)).toBe(true)
    expect(longText.includes(secondChunk)).toBe(true)
  })
})
