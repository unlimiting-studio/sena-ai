import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebClient } from '@slack/web-api'
import type { InboundEvent, TurnEngine } from '@sena-ai/core'
import { normalizeTriggerConfig, processSlackEvent, resolvePromptSource } from '../connector.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function createSlackMock(options?: {
  historyMessage?: Record<string, unknown>
}) {
  const usersInfo = vi.fn(async ({ user }: { user: string }) => ({
    ok: true,
    user: {
      profile: {
        display_name: `${user}-name`,
        real_name: `${user}-real`,
      },
    },
  }))

  const history = vi.fn(async () => ({
    ok: true,
    messages: options?.historyMessage ? [options.historyMessage] : [],
  }))

  const replies = vi.fn(async () => ({ ok: true, messages: [] }))
  const addReaction = vi.fn(async () => ({ ok: true }))

  const slack = {
    users: { info: usersInfo },
    conversations: { history, replies },
    reactions: { add: addReaction },
    auth: {
      test: vi.fn(async () => ({ ok: true, user_id: 'UBOT' })),
    },
  } as unknown as WebClient

  return { slack, usersInfo, history, replies, addReaction }
}

function createEngineMock() {
  const submitTurn = vi.fn<(event: InboundEvent) => Promise<void>>(async () => {})
  const abortConversation = vi.fn<(conversationId: string) => boolean>(() => true)
  return {
    submitTurn,
    abortConversation,
  } satisfies TurnEngine & {
    submitTurn: typeof submitTurn
    abortConversation: typeof abortConversation
  }
}

function firstSubmittedEvent(engine: ReturnType<typeof createEngineMock>): InboundEvent {
  expect(engine.submitTurn).toHaveBeenCalledOnce()
  const inbound = engine.submitTurn.mock.calls[0]?.[0]
  expect(inbound).toBeDefined()
  return inbound!
}

describe('slack trigger config', () => {
  it('uses legacy defaults only when triggers are omitted', () => {
    const legacy = normalizeTriggerConfig(undefined)
    const explicit = normalizeTriggerConfig({ mention: '' })

    expect(legacy.mention).toBe('')
    expect(legacy.thread).toBe('')
    expect(legacy.reactions.x).toEqual({ action: 'abort' })

    expect(explicit.mention).toBe('')
    expect(explicit.thread).toBeUndefined()
    expect(explicit.reactions).toEqual({})
  })

  it('resolves prompt files from the provided base directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sena-slack-trigger-'))
    const promptPath = join(dir, 'mention.md')
    await writeFile(promptPath, '멘션 프롬프트')

    const resolved = await resolvePromptSource({ file: './mention.md' }, dir)
    expect(resolved).toBe('멘션 프롬프트')
  })
})

describe('processSlackEvent', () => {
  it('falls through to the next message trigger when a higher-priority filter returns false', async () => {
    const { slack } = createSlackMock()
    const engine = createEngineMock()
    const userNameCache = new Map<string, string>()
    const activeThreads = new Set<string>()
    const processedEvents = new Set<string>()
    const processingEvents = new Set<string>()

    const mentionFilter = vi.fn(() => false)
    const triggerConfig = normalizeTriggerConfig({
      mention: { text: 'mention prompt', filter: mentionFilter },
      channel: { text: 'channel prompt' },
    })

    await processSlackEvent(
      {
        event: {
          type: 'message',
          channel: 'C1',
          ts: '100.1',
          user: 'U1',
          text: '<@UBOT> hello',
        },
      },
      engine,
      slack,
      'xoxb-token',
      userNameCache,
      activeThreads,
      processedEvents,
      processingEvents,
      triggerConfig,
      '/tmp',
      'UBOT',
    )

    expect(mentionFilter).toHaveBeenCalledOnce()
    const inbound = firstSubmittedEvent(engine)
    expect(isRecord(inbound.raw) ? inbound.raw.triggerKind : undefined).toBe('channel')
    expect(inbound.text).toContain('channel prompt')
    expect(inbound.userName).toBe('U1-name')
  })

  it('hydrates reaction filter events with actor and target message fields', async () => {
    const filter = vi.fn(() => true)
    const { slack } = createSlackMock({
      historyMessage: {
        ts: '200.2',
        text: '대상 메시지',
        user: 'U_TARGET',
      },
    })
    const engine = createEngineMock()

    await processSlackEvent(
      {
        event: {
          type: 'reaction_added',
          reaction: 'eyes',
          user: 'U_ACTOR',
          event_ts: '300.3',
          item: {
            type: 'message',
            channel: 'C1',
            ts: '200.2',
          },
        },
      },
      engine,
      slack,
      'xoxb-token',
      new Map<string, string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      normalizeTriggerConfig({
        reactions: {
          eyes: { text: 'reaction prompt', filter },
        },
      }),
      '/tmp',
      'UBOT',
    )

    expect(filter).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'reaction',
      userId: 'U_ACTOR',
      userName: 'U_ACTOR-name',
      messageUserId: 'U_TARGET',
      messageUserName: 'U_TARGET-name',
      threadTs: '200.2',
      text: '대상 메시지',
    }))
    const inbound = firstSubmittedEvent(engine)
    expect(inbound.conversationId).toBe('C1:200.2')
    expect(inbound.text).toContain('reaction prompt')
    expect(inbound.text).toContain('messageUserId: U_TARGET')
  })

  it('exposes bot-authored reacted messages via messageBotId', async () => {
    const filter = vi.fn(() => true)
    const { slack } = createSlackMock({
      historyMessage: {
        ts: '210.2',
        text: '봇이 쓴 메시지',
        bot_id: 'B_BREN',
        username: '브렌',
      },
    })
    const engine = createEngineMock()

    await processSlackEvent(
      {
        event: {
          type: 'reaction_added',
          reaction: 'eyes',
          user: 'U_ACTOR',
          event_ts: '301.3',
          item: {
            type: 'message',
            channel: 'C1',
            ts: '210.2',
          },
        },
      },
      engine,
      slack,
      'xoxb-token',
      new Map<string, string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      normalizeTriggerConfig({
        reactions: {
          eyes: { text: 'reaction prompt', filter },
        },
      }),
      '/tmp',
      'UBOT',
    )

    expect(filter).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'U_ACTOR',
      messageUserId: undefined,
      messageBotId: 'B_BREN',
      threadTs: '210.2',
    }))
  })

  it('aborts the conversation selected by the reacted message thread ts', async () => {
    const { slack, addReaction } = createSlackMock({
      historyMessage: {
        ts: '220.2',
        thread_ts: '220.0',
        text: '스레드 메시지',
        user: 'U_TARGET',
      },
    })
    const engine = createEngineMock()

    await processSlackEvent(
      {
        event: {
          type: 'reaction_added',
          reaction: 'x',
          user: 'U_ACTOR',
          event_ts: '302.3',
          item: {
            type: 'message',
            channel: 'C1',
            ts: '220.2',
          },
        },
      },
      engine,
      slack,
      'xoxb-token',
      new Map<string, string>(),
      new Set<string>(),
      new Set<string>(),
      new Set<string>(),
      normalizeTriggerConfig({
        reactions: {
          x: { action: 'abort' },
        },
      }),
      '/tmp',
      'UBOT',
    )

    expect(engine.abortConversation).toHaveBeenCalledWith('C1:220.0')
    expect(addReaction).toHaveBeenCalledWith({ channel: 'C1', name: 'x', timestamp: '220.2' })
    expect(engine.submitTurn).not.toHaveBeenCalled()
  })
})
