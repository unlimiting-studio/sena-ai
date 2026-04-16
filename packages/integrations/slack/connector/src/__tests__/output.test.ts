import { describe, it, expect, vi } from 'vitest'
import { createSlackOutput, type SlackClientLike } from '../connector.js'

type PostMessageArgs = Parameters<SlackClientLike['chat']['postMessage']>[0]
type UpdateArgs = Parameters<SlackClientLike['chat']['update']>[0]
type DeleteArgs = Parameters<SlackClientLike['chat']['delete']>[0]
type StreamFactory = NonNullable<SlackClientLike['chatStream']>
type StreamInitArgs = Parameters<StreamFactory>[0]
type StreamAppendArgs = Parameters<ReturnType<StreamFactory>['append']>[0]
type StreamStopArgs = Parameters<ReturnType<StreamFactory>['stop']>[0]

function getText(args: object): string {
  const value = Reflect.get(args, 'text')
  return typeof value === 'string' ? value : ''
}

function getParse(args: object): unknown {
  return Reflect.get(args, 'parse')
}

function getLinkNames(args: object): unknown {
  return Reflect.get(args, 'link_names')
}

function createSlackMock(overrides?: {
  update?: SlackClientLike['chat']['update']
  postMessage?: SlackClientLike['chat']['postMessage']
  chatStream?: SlackClientLike['chatStream']
  useChatStream?: boolean
}) {
  const postCalls: PostMessageArgs[] = []
  const updateCalls: UpdateArgs[] = []
  const deleteCalls: DeleteArgs[] = []
  const streamInitCalls: StreamInitArgs[] = []
  const streamAppendCalls: StreamAppendArgs[] = []
  const streamStopCalls: StreamStopArgs[] = []

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

  const defaultChatStream: StreamFactory = (args) => {
    streamInitCalls.push(args)
    return {
      append: async (appendArgs) => {
        streamAppendCalls.push(appendArgs)
        return { ts: 'stream-ts-1' }
      },
      stop: async (stopArgs) => {
        streamStopCalls.push(stopArgs)
        return { ts: 'stream-ts-1' }
      },
    }
  }

  const slack: SlackClientLike = {
    chat: {
      postMessage: overrides?.postMessage ?? defaultPostMessage,
      update: overrides?.update ?? defaultUpdate,
      delete: defaultDelete,
    },
    ...((overrides?.useChatStream || overrides?.chatStream)
      ? { chatStream: overrides?.chatStream ?? defaultChatStream }
      : {}),
  }

  return {
    slack,
    postCalls,
    updateCalls,
    deleteCalls,
    streamInitCalls,
    streamAppendCalls,
    streamStopCalls,
  }
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
    expect(getParse(postCalls[0])).toBe('none')
    expect(getLinkNames(postCalls[0])).toBe(false)
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

  it('deletes the thinking message when the final result is empty and no content was produced', async () => {
    const { slack, postCalls, updateCalls, deleteCalls } = createSlackMock()

    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    await Promise.resolve()
    await Promise.resolve()

    await output.sendResult('')

    expect(postCalls).toHaveLength(1)
    expect(updateCalls).toHaveLength(0)
    expect(deleteCalls).toHaveLength(1)
  })

  it('streams general output by default when the Slack stream helper and recipient metadata are available', async () => {
    const {
      slack,
      postCalls,
      deleteCalls,
      updateCalls,
      streamInitCalls,
      streamAppendCalls,
      streamStopCalls,
    } = createSlackMock({ useChatStream: true })

    const output = createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: {
          team_id: 'T123',
          event: { user: 'U123' },
        },
      },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    await Promise.resolve()
    await Promise.resolve()

    await output.showProgress('초안')
    await output.sendResult('초안을 마무리했어요')

    expect(postCalls).toHaveLength(1)
    expect(deleteCalls).toHaveLength(1)
    expect(streamInitCalls).toHaveLength(1)
    expect(streamAppendCalls).toEqual([{ markdown_text: '초안' }])
    expect(streamStopCalls).toEqual([{ markdown_text: '을 마무리했어요' }])
    expect(updateCalls).toHaveLength(1)
    expect(getText(updateCalls[0])).toBe('초안을 마무리했어요')
  })

  it('rewrites even plain-text final stream output onto the same ts so the full final text remains visible', async () => {
    const {
      slack,
      updateCalls,
      streamInitCalls,
      streamAppendCalls,
      streamStopCalls,
    } = createSlackMock({ useChatStream: true })

    const output = createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: {
          team_id: 'T123',
          event: { user: 'U123' },
        },
      },
      false,
    )

    const finalText = '테스트 메시지예요.\n지금 이 답변은 일반 출력 경로로 나가고 있어요.\n*이 문장은 bold로 보여야 해요.*'
    await output.sendResult(finalText)

    expect(streamInitCalls).toHaveLength(1)
    expect(streamAppendCalls).toHaveLength(0)
    expect(streamStopCalls).toEqual([{ markdown_text: finalText }])
    expect(updateCalls).toHaveLength(1)
    expect(getText(updateCalls[0])).toBe(finalText)
  })

  it('reposts the final stream output as a fresh message when it contains a URL so Slack can unfurl it', async () => {
    const {
      slack,
      postCalls,
      deleteCalls,
      updateCalls,
      streamInitCalls,
      streamAppendCalls,
      streamStopCalls,
    } = createSlackMock({ useChatStream: true })

    const output = createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: {
          team_id: 'T123',
          event: { user: 'U123' },
        },
      },
      false,
    )

    const finalText = '배포 완료예요.\nhttps://github.com/Variel/skills/commit/a5ae525'
    await output.sendResult(finalText)

    expect(streamInitCalls).toHaveLength(1)
    expect(streamAppendCalls).toHaveLength(0)
    expect(streamStopCalls).toEqual([{ markdown_text: finalText }])
    expect(deleteCalls).toEqual([{ channel: 'C0AFW5Y133J', ts: 'stream-ts-1' }])
    expect(updateCalls).toHaveLength(0)
    expect(postCalls).toHaveLength(1)
    expect(getText(postCalls[0])).toBe(finalText)
  })

  it('rewrites the completed stream into a final safe payload when table blocks are needed', async () => {
    const {
      slack,
      updateCalls,
      streamInitCalls,
      streamAppendCalls,
      streamStopCalls,
    } = createSlackMock({ useChatStream: true })

    const output = createSlackOutput(
      slack,
      {
        connector: 'slack',
        conversationId: 'C0AFW5Y133J:1775295864.093159',
        metadata: {
          team_id: 'T123',
          event: { user: 'U123' },
        },
      },
      false,
    )

    const finalText = '상태: *완료*\n\n| 항목 | 값 |\n|---|---|\n| A | 1 |'
    await output.sendResult(finalText)

    expect(streamInitCalls).toHaveLength(1)
    expect(streamAppendCalls).toHaveLength(0)
    expect(streamStopCalls).toEqual([{ markdown_text: finalText }])
    expect(updateCalls).toHaveLength(1)
    expect(getText(updateCalls[0])).toContain('*완료*')
    expect(Array.isArray(Reflect.get(updateCalls[0], 'blocks'))).toBe(true)
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



  it('bypasses throttle and rolls live preview into continuation messages before hitting Slack limits', async () => {
    vi.useFakeTimers()

    try {
      const { slack, postCalls, updateCalls } = createSlackMock()
      const output = createSlackOutput(
        slack,
        { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
        false,
      )

      const longText = Array.from({ length: 900 }, (_, i) => `단어${i}`).join(' ')
      await output.showProgress(longText.slice(0, 120))
      expect(postCalls).toHaveLength(1)
      expect(updateCalls).toHaveLength(0)

      await output.showProgress(longText)

      expect(updateCalls.length).toBeGreaterThanOrEqual(1)
      expect(postCalls.length).toBeGreaterThanOrEqual(2)

      const firstChunk = getText(updateCalls[updateCalls.length - 1])
      const continuation = getText(postCalls[postCalls.length - 1])

      expect(firstChunk.length).toBeLessThanOrEqual(2200)
      expect(continuation.length).toBeLessThanOrEqual(2200)
      expect(longText.startsWith(firstChunk)).toBe(true)
      expect(longText.includes(continuation)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('splits oversized live progress into continuation messages without truncation markers or duplicate payloads', async () => {
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

    expect(postCalls.length).toBeGreaterThan(1)
    expect(updateCalls.length).toBeGreaterThanOrEqual(1)

    const texts = [...postCalls, ...updateCalls].map(getText)
    expect(texts.some(text => text.includes('계속 생성 중'))).toBe(false)
    expect(new Set(texts).size).toBe(texts.length)
    expect([...postCalls, ...updateCalls].every(call => getParse(call) === 'none')).toBe(true)
  })

  it('sends plain-text chunked final messages with safe-mode options', async () => {
    const { slack, postCalls, updateCalls } = createSlackMock({
      update: vi.fn(async (args) => {
        updateCalls.push(args)
        throw new Error('force chunk delivery')
      }),
    })

    const output = createSlackOutput(
      slack,
      { connector: 'slack', conversationId: 'C0AFW5Y133J:1775295864.093159' },
      ':loading-dots: 브렌이 생각 중이에요',
    )

    const longText = '설명 '.repeat(1400)
    await output.sendResult(longText)

    expect(updateCalls.length).toBeGreaterThan(0)
    expect(getParse(updateCalls[updateCalls.length - 1])).toBe('none')
    expect(getLinkNames(updateCalls[updateCalls.length - 1])).toBe(false)
    expect(getParse(postCalls[postCalls.length - 1])).toBe('none')
    expect(getLinkNames(postCalls[postCalls.length - 1])).toBe(false)
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
