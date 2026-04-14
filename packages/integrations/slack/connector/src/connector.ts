import type {
  Connector,
  ConnectorContext,
  InboundEvent,
  ConnectorOutput,
  ConnectorOutputContext,
  HttpServer,
  TurnEngine,
  FileAttachment,
} from '@sena-ai/core'
import {
  createSlackTextPayload,
  markdownToSlack,
  type SlackMessagePayload,
} from '@sena-ai/slack-mrkdwn'
import { WebClient } from '@slack/web-api'
import { SocketModeClient } from '@slack/socket-mode'
import { verifySignature } from './verify.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export type SlackMessageTriggerEvent = {
  kind: 'mention' | 'thread' | 'directMessage' | 'channel' | 'message'
  channelId: string
  userId: string
  userName?: string
  text: string
  ts: string
  threadTs?: string
  files?: Array<{ id?: string; name?: string; mimeType?: string }>
  raw: unknown
}

export type SlackReactionTriggerEvent = {
  kind: 'reaction'
  channelId: string
  userId: string
  userName?: string
  messageUserId?: string
  messageUserName?: string
  messageBotId?: string
  text: string
  ts: string
  threadTs: string
  reaction: string
  files?: Array<{ id?: string; name?: string; mimeType?: string }>
  raw: unknown
}

export type SlackMessageTriggerFilter = (
  event: SlackMessageTriggerEvent,
) => boolean | void | Promise<boolean | void>

export type SlackReactionTriggerFilter = (
  event: SlackReactionTriggerEvent,
) => boolean | void | Promise<boolean | void>

type SlackThinkingMessage = string | false

type SlackPromptSource =
  | string
  | { text: string; thinkingMessage?: SlackThinkingMessage; disabledTools?: string[] }
  | { file: string; thinkingMessage?: SlackThinkingMessage; disabledTools?: string[] }

export type SlackMessageTriggerFunctionResult = SlackPromptSource

export type SlackReactionTriggerFunctionResult =
  | SlackPromptSource
  | { abort: true }

export type SlackMessageTriggerFunction = (
  event: SlackMessageTriggerEvent,
) =>
  | SlackMessageTriggerFunctionResult
  | false
  | void
  | Promise<SlackMessageTriggerFunctionResult | false | void>

export type SlackReactionTriggerFunction = (
  event: SlackReactionTriggerEvent,
) =>
  | SlackReactionTriggerFunctionResult
  | false
  | void
  | Promise<SlackReactionTriggerFunctionResult | false | void>

export type SlackMessagePromptTrigger =
  | string
  | { text: string; filter?: SlackMessageTriggerFilter; thinkingMessage?: SlackThinkingMessage }
  | { file: string; filter?: SlackMessageTriggerFilter; thinkingMessage?: SlackThinkingMessage }
  | SlackMessageTriggerFunction

export type SlackReactionPromptTrigger =
  | string
  | { text: string; filter?: SlackReactionTriggerFilter; thinkingMessage?: SlackThinkingMessage }
  | { file: string; filter?: SlackReactionTriggerFilter; thinkingMessage?: SlackThinkingMessage }

export type SlackReactionRule =
  | SlackReactionPromptTrigger
  | { action: 'abort'; filter?: SlackReactionTriggerFilter }
  | SlackReactionTriggerFunction

export type SlackTriggerConfig = {
  mention?: SlackMessagePromptTrigger
  thread?: SlackMessagePromptTrigger
  directMessage?: SlackMessagePromptTrigger
  channel?: SlackMessagePromptTrigger
  message?: SlackMessagePromptTrigger
  reactions?: Record<string, SlackReactionRule>
}

export type SlackConnectorOptions = {
  appId: string
  botToken: string
  /** Message shown immediately when a turn starts (e.g. ":loading-dots: *세나가 생각중이에요*"). Set to false to disable. */
  thinkingMessage?: string | false
  triggers?: SlackTriggerConfig
} & (
  | {
      /** HTTP Events API mode (default). Requires a public endpoint + signingSecret. */
      mode?: 'http'
      signingSecret: string
      appToken?: never
    }
  | {
      /** Socket Mode — no public endpoint needed. Requires an app-level token (xapp-…). */
      mode: 'socket'
      /** App-level token for Socket Mode (starts with xapp-). */
      appToken: string
      signingSecret?: never
    }
)

export type SlackChatApi = {
  postMessage: WebClient['chat']['postMessage']
  update: WebClient['chat']['update']
  delete: WebClient['chat']['delete']
}

export type SlackClientLike = {
  chat: SlackChatApi
}

type NormalizedSlackTriggerConfig = {
  mention?: SlackMessagePromptTrigger
  thread?: SlackMessagePromptTrigger
  directMessage?: SlackMessagePromptTrigger
  channel?: SlackMessagePromptTrigger
  message?: SlackMessagePromptTrigger
  reactions: Record<string, SlackReactionRule>
}

type ParsedSlackFile = {
  id: string
  name: string
  mimetype: string
  url_private?: string
}

type ParsedSlackMessageEvent = {
  type: 'app_mention' | 'message'
  channel: string
  channelType?: string
  ts: string
  userId: string
  text: string
  threadTs?: string
  files: ParsedSlackFile[]
  subtype?: string
  botId?: string
}

type ParsedSlackReactionEvent = {
  type: 'reaction_added'
  channel: string
  messageTs: string
  reaction: string
  userId: string
  itemUserId?: string
  eventTs?: string
}

type SlackLookupMessage = {
  channel: string
  ts: string
  threadTs?: string
  text: string
  userId?: string
  userName?: string
  botId?: string
  files: ParsedSlackFile[]
  raw: Record<string, unknown>
}

type MessageTriggerKind = 'mention' | 'thread' | 'directMessage' | 'channel' | 'message'

type MessageCandidate = {
  kind: MessageTriggerKind
  source: SlackMessagePromptTrigger
}

type ResolvedSlackPromptSource =
  | SlackPromptSource
  | Exclude<SlackMessagePromptTrigger, SlackMessageTriggerFunction>
  | SlackReactionPromptTrigger

type MessageCandidateSelection = {
  kind: MessageTriggerKind
  source: ResolvedSlackPromptSource
}

type ReactionRuleSelection =
  | { action: 'skip' }
  | { action: 'abort' }
  | { action: 'submit'; source: ResolvedSlackPromptSource }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function readFileList(record: Record<string, unknown>, key: string): ParsedSlackFile[] {
  const value = record[key]
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!isRecord(item)) return []
    const id = readString(item, 'id')
    const name = readString(item, 'name')
    const mimetype = readString(item, 'mimetype')
    if (!id || !name || !mimetype) return []
    return [{
      id,
      name,
      mimetype,
      url_private: readString(item, 'url_private'),
    }]
  })
}

function toAttachmentMetadata(files: ParsedSlackFile[]): Array<{ id?: string; name?: string; mimeType?: string }> | undefined {
  if (files.length === 0) return undefined
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimetype,
  }))
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

function isThinkingMessage(value: unknown): value is SlackThinkingMessage {
  return typeof value === 'string' || value === false
}

function isPromptRule(
  value: unknown,
): value is { text: string; filter?: unknown; thinkingMessage?: SlackThinkingMessage } | { file: string; filter?: unknown; thinkingMessage?: SlackThinkingMessage } {
  if (!isRecord(value)) return false
  const hasText = typeof value.text === 'string'
  const hasFile = typeof value.file === 'string'
  if (hasText === hasFile) return false
  if (value.filter !== undefined && !isFunction(value.filter)) return false
  return value.thinkingMessage === undefined || isThinkingMessage(value.thinkingMessage)
}

function isPromptSourceResult(value: unknown): value is Exclude<SlackPromptSource, string> {
  if (!isRecord(value)) return false
  const hasText = typeof value.text === 'string'
  const hasFile = typeof value.file === 'string'
  if (hasText === hasFile) return false
  if (value.thinkingMessage !== undefined && !isThinkingMessage(value.thinkingMessage)) return false
  if (value.disabledTools !== undefined && !Array.isArray(value.disabledTools)) return false

  const allowedKeys = hasText
    ? ['text', 'thinkingMessage', 'disabledTools']
    : ['file', 'thinkingMessage', 'disabledTools']
  return Object.keys(value).every(key => allowedKeys.includes(key))
}

function isReactionActionRule(value: unknown): value is { action: 'abort'; filter?: unknown } {
  if (!isRecord(value)) return false
  if (value.action !== 'abort') return false
  return value.filter === undefined || isFunction(value.filter)
}

function isReactionAbortResult(value: unknown): value is { abort: true } {
  if (!isRecord(value) || value.abort !== true) return false
  return Object.keys(value).every(key => key === 'abort')
}

function isMessageTriggerFunctionResult(value: unknown): value is SlackMessageTriggerFunctionResult {
  return typeof value === 'string' || isPromptSourceResult(value)
}

function isReactionTriggerFunctionResult(value: unknown): value is SlackReactionTriggerFunctionResult {
  return isMessageTriggerFunctionResult(value) || isReactionAbortResult(value)
}

function assertMessagePromptTrigger(value: unknown, path: string): asserts value is SlackMessagePromptTrigger {
  if (typeof value === 'string' || isPromptRule(value) || isFunction(value)) return
  throw new Error(`Invalid Slack trigger config at ${path}`)
}

function assertReactionRule(value: unknown, path: string): asserts value is SlackReactionRule {
  if (typeof value === 'string' || isPromptRule(value) || isReactionActionRule(value) || isFunction(value)) return
  throw new Error(`Invalid Slack reaction rule at ${path}`)
}

export function normalizeTriggerConfig(triggers?: SlackTriggerConfig): NormalizedSlackTriggerConfig {
  if (triggers === undefined) {
    return {
      mention: '',
      thread: '',
      reactions: {
        x: { action: 'abort' },
      },
    }
  }

  const normalized: NormalizedSlackTriggerConfig = {
    reactions: {},
  }

  if (triggers.mention !== undefined) {
    assertMessagePromptTrigger(triggers.mention, 'triggers.mention')
    normalized.mention = triggers.mention
  }
  if (triggers.thread !== undefined) {
    assertMessagePromptTrigger(triggers.thread, 'triggers.thread')
    normalized.thread = triggers.thread
  }
  if (triggers.directMessage !== undefined) {
    assertMessagePromptTrigger(triggers.directMessage, 'triggers.directMessage')
    normalized.directMessage = triggers.directMessage
  }
  if (triggers.channel !== undefined) {
    assertMessagePromptTrigger(triggers.channel, 'triggers.channel')
    normalized.channel = triggers.channel
  }
  if (triggers.message !== undefined) {
    assertMessagePromptTrigger(triggers.message, 'triggers.message')
    normalized.message = triggers.message
  }
  if (triggers.reactions !== undefined) {
    for (const [emoji, rule] of Object.entries(triggers.reactions)) {
      assertReactionRule(rule, `triggers.reactions.${emoji}`)
      normalized.reactions[emoji] = rule
    }
  }

  return normalized
}

function getMessageFilter(source: SlackMessagePromptTrigger): SlackMessageTriggerFilter | undefined {
  if (typeof source === 'string' || isFunction(source)) return undefined
  return source.filter
}

function getReactionFilter(rule: SlackReactionRule): SlackReactionTriggerFilter | undefined {
  if (typeof rule === 'string' || isFunction(rule)) return undefined
  if (isReactionActionRule(rule)) return rule.filter
  return rule.filter
}

function isReactionAbortRule(rule: SlackReactionRule): rule is { action: 'abort'; filter?: SlackReactionTriggerFilter } {
  return typeof rule !== 'string' && isReactionActionRule(rule)
}

export async function resolvePromptSource(
  source: ResolvedSlackPromptSource,
  baseDir: string,
): Promise<string> {
  if (typeof source === 'string') return source
  if ('text' in source) return source.text
  return readFile(resolve(baseDir, source.file), 'utf8')
}

async function runMessageTriggerFilter(
  source: SlackMessagePromptTrigger,
  event: SlackMessageTriggerEvent,
): Promise<boolean> {
  const filter = getMessageFilter(source)
  if (!filter) return true
  const result = await filter(event)
  return result !== false
}

async function runReactionTriggerFilter(
  rule: SlackReactionRule,
  event: SlackReactionTriggerEvent,
): Promise<boolean> {
  const filter = getReactionFilter(rule)
  if (!filter) return true
  const result = await filter(event)
  return result !== false
}

function containsBotMention(text: string, botUserId: string | undefined): boolean {
  if (!botUserId) return false
  return text.includes(`<@${botUserId}>`)
}

function isDirectMessageChannel(event: ParsedSlackMessageEvent): boolean {
  if (event.channelType !== undefined) return event.channelType === 'im'
  return event.channel.startsWith('D')
}

function buildConversationId(channel: string, threadTs: string | undefined, ts: string): string {
  return `${channel}:${threadTs ?? ts}`
}

function buildMessageInputText(prompt: string, messageText: string): string {
  const sections = [prompt.trim(), messageText].filter((part) => part.length > 0)
  return sections.join('\n\n')
}

function buildReactionContextText(event: SlackReactionTriggerEvent): string {
  const lines = [
    `reaction: :${event.reaction}:`,
    `actorUserId: ${event.userId}`,
    event.userName ? `actorUserName: ${event.userName}` : '',
    `channelId: ${event.channelId}`,
    `threadTs: ${event.threadTs}`,
    `messageTs: ${event.ts}`,
    event.messageUserId ? `messageUserId: ${event.messageUserId}` : '',
    event.messageUserName ? `messageUserName: ${event.messageUserName}` : '',
    event.messageBotId ? `messageBotId: ${event.messageBotId}` : '',
    '',
    'targetMessage:',
    event.text || '(empty)',
  ].filter((line) => line.length > 0)

  return lines.join('\n')
}

function buildReactionInputText(prompt: string, event: SlackReactionTriggerEvent): string {
  const contextText = buildReactionContextText(event)
  const sections = [prompt.trim(), contextText].filter((part) => part.length > 0)
  return sections.join('\n\n')
}

function getPromptSourceMetadata(
  source: ResolvedSlackPromptSource,
): { triggerPromptSource: 'inline-string' | 'inline-text' | 'file'; triggerPromptFile?: string } {
  if (typeof source === 'string') {
    return { triggerPromptSource: 'inline-string' }
  }
  if ('text' in source) {
    return { triggerPromptSource: 'inline-text' }
  }
  return {
    triggerPromptSource: 'file',
    triggerPromptFile: source.file,
  }
}

function buildReactionInboundText(prompt: string, event: SlackReactionTriggerEvent): {
  fullText: string
  userText: string
} {
  return {
    fullText: buildReactionInputText(prompt, event),
    userText: buildReactionContextText(event),
  }
}

function buildMessageInboundText(prompt: string, messageText: string): {
  fullText: string
  userText: string
} {
  return {
    fullText: buildMessageInputText(prompt, messageText),
    userText: messageText,
  }
}

function getDisabledTools(
  source: SlackPromptSource | SlackMessagePromptTrigger | SlackReactionPromptTrigger,
): string[] | undefined {
  if (typeof source === 'string' || isFunction(source)) return undefined
  if ('disabledTools' in source && Array.isArray(source.disabledTools)) return source.disabledTools
  return undefined
}

function getThinkingMessageOverride(
  source: SlackPromptSource | SlackMessagePromptTrigger | SlackReactionPromptTrigger,
): SlackThinkingMessage | undefined {
  if (typeof source === 'string' || isFunction(source)) return undefined
  return source.thinkingMessage
}

function resolveThinkingMessage(
  triggerThinkingMessage: SlackThinkingMessage | undefined,
  globalThinkingMessage: string | false | undefined,
): string | false | undefined {
  if (triggerThinkingMessage !== undefined) return triggerThinkingMessage
  return globalThinkingMessage
}

function readThinkingMessageFromMetadata(metadata: unknown): SlackThinkingMessage | undefined {
  if (!isRecord(metadata)) return undefined
  return isThinkingMessage(metadata.thinkingMessage)
    ? metadata.thinkingMessage
    : undefined
}

function parseMessageEvent(body: Record<string, unknown>): ParsedSlackMessageEvent | null {
  const event = readRecord(body, 'event')
  if (!event) return null
  const type = readString(event, 'type')
  if (type !== 'app_mention' && type !== 'message') return null

  const channel = readString(event, 'channel')
  const ts = readString(event, 'ts')
  if (!channel || !ts) return null

  return {
    type,
    channel,
    channelType: readString(event, 'channel_type'),
    ts,
    userId: readString(event, 'user') ?? '',
    text: readString(event, 'text') ?? '',
    threadTs: readString(event, 'thread_ts'),
    files: readFileList(event, 'files'),
    subtype: readString(event, 'subtype'),
    botId: readString(event, 'bot_id'),
  }
}

function parseReactionEvent(body: Record<string, unknown>): ParsedSlackReactionEvent | null {
  const event = readRecord(body, 'event')
  if (!event) return null
  if (readString(event, 'type') !== 'reaction_added') return null

  const item = readRecord(event, 'item')
  if (!item || readString(item, 'type') !== 'message') return null

  const channel = readString(item, 'channel')
  const messageTs = readString(item, 'ts')
  const reaction = readString(event, 'reaction')
  const userId = readString(event, 'user')
  if (!channel || !messageTs || !reaction || !userId) return null

  return {
    type: 'reaction_added',
    channel,
    messageTs,
    reaction,
    userId,
    itemUserId: readString(event, 'item_user'),
    eventTs: readString(event, 'event_ts'),
  }
}

export function selectMessageCandidates(
  event: ParsedSlackMessageEvent,
  triggerConfig: NormalizedSlackTriggerConfig,
  activeThreads: Set<string>,
  botUserId: string | undefined,
): MessageCandidate[] {
  const candidates: MessageCandidate[] = []
  const threadKey = buildConversationId(event.channel, event.threadTs, event.ts)
  const directMessageActive = isDirectMessageChannel(event)

  const mentionActive = triggerConfig.mention !== undefined
    && (event.type === 'app_mention' || containsBotMention(event.text, botUserId))
  if (mentionActive && triggerConfig.mention !== undefined) {
    candidates.push({ kind: 'mention', source: triggerConfig.mention })
  }

  const threadActive = triggerConfig.thread !== undefined
    && event.threadTs !== undefined
    && activeThreads.has(threadKey)
  if (threadActive && triggerConfig.thread !== undefined) {
    candidates.push({ kind: 'thread', source: triggerConfig.thread })
  }

  if (directMessageActive && triggerConfig.directMessage !== undefined) {
    candidates.push({ kind: 'directMessage', source: triggerConfig.directMessage })
  }

  const channelActive = triggerConfig.channel !== undefined
    && event.threadTs === undefined
    && !directMessageActive
  if (channelActive && triggerConfig.channel !== undefined) {
    candidates.push({ kind: 'channel', source: triggerConfig.channel })
  }

  const messageActive = triggerConfig.message !== undefined
  if (messageActive && triggerConfig.message !== undefined) {
    candidates.push({ kind: 'message', source: triggerConfig.message })
  }

  return candidates.sort((a, b) => messageTriggerPriority(a.kind) - messageTriggerPriority(b.kind))
}

function messageTriggerPriority(kind: MessageTriggerKind): number {
  switch (kind) {
    case 'mention':
      return 0
    case 'thread':
      return 1
    case 'directMessage':
      return 2
    case 'channel':
      return 3
    case 'message':
      return 4
  }
}

function buildMessageTriggerEvent(
  kind: MessageTriggerKind,
  event: ParsedSlackMessageEvent,
  userName: string,
  body: Record<string, unknown>,
): SlackMessageTriggerEvent {
  return {
    kind,
    channelId: event.channel,
    userId: event.userId,
    userName,
    text: event.text,
    ts: event.ts,
    threadTs: event.threadTs,
    files: toAttachmentMetadata(event.files),
    raw: body,
  }
}

async function evaluateMessageCandidate(
  candidate: MessageCandidate,
  triggerEvent: SlackMessageTriggerEvent,
): Promise<MessageCandidateSelection | null> {
  if (isFunction(candidate.source)) {
    const result = await candidate.source(triggerEvent)
    if (result === false || result === undefined) return null
    if (!isMessageTriggerFunctionResult(result)) {
      throw new Error(`Invalid Slack trigger function result for ${candidate.kind}`)
    }
    return { kind: candidate.kind, source: result }
  }

  const passed = await runMessageTriggerFilter(candidate.source, triggerEvent)
  if (!passed) return null
  return { kind: candidate.kind, source: candidate.source }
}

async function evaluateReactionRule(
  rule: SlackReactionRule,
  event: SlackReactionTriggerEvent,
): Promise<ReactionRuleSelection> {
  if (isFunction(rule)) {
    const result = await rule(event)
    if (result === false || result === undefined) return { action: 'skip' }
    if (!isReactionTriggerFunctionResult(result)) {
      throw new Error(`Invalid Slack reaction rule function result for :${event.reaction}:`)
    }
    if (isReactionAbortResult(result)) {
      return { action: 'abort' }
    }
    return { action: 'submit', source: result }
  }

  const passed = await runReactionTriggerFilter(rule, event)
  if (!passed) return { action: 'skip' }
  if (isReactionAbortRule(rule)) return { action: 'abort' }
  return { action: 'submit', source: rule }
}

async function resolveUserName(
  slack: WebClient,
  userId: string,
  cache: Map<string, string>,
): Promise<string> {
  if (!userId) return ''
  const cached = cache.get(userId)
  if (cached !== undefined) return cached

  try {
    const result = await slack.users.info({ user: userId })
    const profile = result.user?.profile
    const name = profile?.display_name || profile?.real_name || userId
    cache.set(userId, name)
    return name
  } catch (err) {
    console.warn(`[slack] failed to resolve username for ${userId}:`, err)
    cache.set(userId, userId)
    return userId
  }
}

async function wasBotInThread(
  slack: WebClient,
  channel: string,
  threadTs: string,
  botUserId: string | undefined,
): Promise<boolean> {
  if (!botUserId) return false
  try {
    const result = await slack.conversations.replies({
      channel,
      ts: threadTs,
      limit: 50,
    })
    const mentionPattern = `<@${botUserId}>`
    return result.messages?.some((message) =>
      message.text?.includes(mentionPattern) || message.user === botUserId,
    ) ?? false
  } catch (err) {
    console.warn('[slack] failed to check thread history for bot participation:', err)
    return false
  }
}

async function downloadSlackFiles(
  files: ParsedSlackFile[],
  botToken: string,
): Promise<FileAttachment[]> {
  const dir = join(tmpdir(), 'slack-files')
  await mkdir(dir, { recursive: true })

  return Promise.all(
    files.map(async (file): Promise<FileAttachment> => {
      const base: FileAttachment = {
        id: file.id,
        name: file.name,
        mimeType: file.mimetype,
        url: file.url_private,
      }
      if (!file.url_private) return base

      try {
        const response = await fetch(file.url_private, {
          headers: { Authorization: `Bearer ${botToken}` },
        })
        if (!response.ok) {
          console.warn(`[slack] file download failed for ${file.id}: ${response.status}`)
          return base
        }
        const buffer = Buffer.from(await response.arrayBuffer())
        const ext = file.name.includes('.') ? '' : `.${file.mimetype.split('/')[1] ?? 'bin'}`
        const localPath = join(dir, `${file.id}_${file.name}${ext}`)
        await writeFile(localPath, buffer)
        return { ...base, localPath }
      } catch (err) {
        console.warn(`[slack] file download error for ${file.id}:`, err)
        return base
      }
    }),
  )
}

async function lookupSlackMessage(
  slack: WebClient,
  channel: string,
  ts: string,
  userNameCache: Map<string, string>,
): Promise<SlackLookupMessage | null> {
  try {
    const result = await slack.conversations.history({
      channel,
      latest: ts,
      oldest: ts,
      inclusive: true,
      limit: 1,
    })
    const rawMessage = result.messages?.[0]
    if (!rawMessage) return null

    const userId = typeof rawMessage.user === 'string' ? rawMessage.user : undefined
    const userName = userId
      ? await resolveUserName(slack, userId, userNameCache)
      : (typeof rawMessage.username === 'string' ? rawMessage.username : undefined)
    const files = Array.isArray(rawMessage.files)
      ? rawMessage.files.flatMap((item) => {
          if (!isRecord(item)) return []
          const id = readString(item, 'id')
          const name = readString(item, 'name')
          const mimetype = readString(item, 'mimetype')
          if (!id || !name || !mimetype) return []
          return [{
            id,
            name,
            mimetype,
            url_private: readString(item, 'url_private'),
          } satisfies ParsedSlackFile]
        })
      : []

    const rawRecord = rawMessage as unknown as Record<string, unknown>
    return {
      channel,
      ts: typeof rawMessage.ts === 'string' ? rawMessage.ts : ts,
      threadTs: typeof rawMessage.thread_ts === 'string' ? rawMessage.thread_ts : undefined,
      text: typeof rawMessage.text === 'string' ? rawMessage.text : '',
      userId,
      userName,
      botId: readString(rawRecord, 'bot_id'),
      files,
      raw: rawRecord,
    }
  } catch (err) {
    console.warn(`[slack] failed to lookup message ${channel}:${ts}:`, err)
    return null
  }
}

async function buildReactionContext(
  body: Record<string, unknown>,
  reaction: ParsedSlackReactionEvent,
  slack: WebClient,
  botToken: string,
  userNameCache: Map<string, string>,
): Promise<{ conversationId: string; filterEvent: SlackReactionTriggerEvent; files?: FileAttachment[] } | null> {
  const targetMessage = await lookupSlackMessage(slack, reaction.channel, reaction.messageTs, userNameCache)
  if (!targetMessage) return null

  const actorUserName = await resolveUserName(slack, reaction.userId, userNameCache)
  const files = targetMessage.files.length > 0
    ? await downloadSlackFiles(targetMessage.files, botToken)
    : undefined
  const threadTs = targetMessage.threadTs ?? targetMessage.ts

  return {
    conversationId: `${reaction.channel}:${threadTs}`,
    files,
    filterEvent: {
      kind: 'reaction',
      channelId: reaction.channel,
      userId: reaction.userId,
      userName: actorUserName,
      messageUserId: targetMessage.userId,
      messageUserName: targetMessage.userName,
      messageBotId: targetMessage.botId,
      text: targetMessage.text,
      ts: targetMessage.ts,
      threadTs,
      reaction: reaction.reaction,
      files: toAttachmentMetadata(targetMessage.files),
      raw: {
        body,
        message: targetMessage.raw,
      },
    },
  }
}

function createReactionEventId(reaction: ParsedSlackReactionEvent): string {
  return [
    'reaction',
    reaction.channel,
    reaction.messageTs,
    reaction.userId,
    reaction.reaction,
    reaction.eventTs ?? '',
  ].join(':')
}

function createMessageEventId(event: ParsedSlackMessageEvent): string {
  return `${event.channel}:${event.ts}`
}

function commitProcessedEvent(processedEvents: Set<string>, processingEvents: Set<string>, eventId: string) {
  processedEvents.add(eventId)
  processingEvents.delete(eventId)

  if (processedEvents.size > 500) {
    const excess = processedEvents.size - 500
    let removed = 0
    for (const entry of processedEvents) {
      if (removed >= excess) break
      processedEvents.delete(entry)
      removed++
    }
  }
}

export async function processSlackEvent(
  body: Record<string, unknown>,
  engine: TurnEngine,
  slack: WebClient,
  botToken: string,
  userNameCache: Map<string, string>,
  activeThreads: Set<string>,
  processedEvents: Set<string>,
  processingEvents: Set<string>,
  triggerConfig: NormalizedSlackTriggerConfig,
  promptBaseDir: string,
  botUserId?: string,
  globalThinkingMessage?: string | false,
): Promise<void> {
  const reactionEvent = parseReactionEvent(body)
  if (reactionEvent) {
    const rule = triggerConfig.reactions[reactionEvent.reaction]
    if (!rule) return

    const eventId = createReactionEventId(reactionEvent)
    if (processedEvents.has(eventId) || processingEvents.has(eventId)) {
      console.log(`[slack] skipping duplicate reaction ${eventId}`)
      return
    }
    processingEvents.add(eventId)

    try {
      const context = await buildReactionContext(body, reactionEvent, slack, botToken, userNameCache)
      if (!context) {
        processingEvents.delete(eventId)
        return
      }

      const selectedRule = await evaluateReactionRule(rule, context.filterEvent)
      if (selectedRule.action === 'skip') {
        commitProcessedEvent(processedEvents, processingEvents, eventId)
        return
      }

      if (selectedRule.action === 'abort') {
        const aborted = engine.abortConversation(context.conversationId)
        if (aborted && reactionEvent.reaction === 'x') {
          try {
            await slack.reactions.add({
              channel: reactionEvent.channel,
              name: 'x',
              timestamp: reactionEvent.messageTs,
            })
          } catch {
            // ignore confirmation reaction failures
          }
        }
        commitProcessedEvent(processedEvents, processingEvents, eventId)
        return
      }

      const thinkingMessage = resolveThinkingMessage(
        getThinkingMessageOverride(selectedRule.source),
        globalThinkingMessage,
      )
      const prompt = await resolvePromptSource(selectedRule.source, promptBaseDir)
      const promptSourceMeta = getPromptSourceMetadata(selectedRule.source)
      const inboundText = buildReactionInboundText(prompt, context.filterEvent)
      const disabledTools = getDisabledTools(selectedRule.source)
      const inbound: InboundEvent = {
        connector: 'slack',
        conversationId: context.conversationId,
        userId: context.filterEvent.userId,
        userName: context.filterEvent.userName ?? '',
        text: inboundText.fullText,
        userText: inboundText.userText,
        files: context.files,
        raw: {
          ...(isRecord(context.filterEvent.raw) ? context.filterEvent.raw : { value: context.filterEvent.raw }),
          triggerKind: 'reaction',
          thinkingMessage,
          ...promptSourceMeta,
        },
        disabledTools,
      }

      activeThreads.add(context.conversationId)
      commitProcessedEvent(processedEvents, processingEvents, eventId)
      await engine.submitTurn(inbound)
      return
    } catch (err) {
      processingEvents.delete(eventId)
      console.error('[slack] failed to process reaction event:', err)
      return
    }
  }

  const messageEvent = parseMessageEvent(body)
  if (!messageEvent) {
    const eventRecord = readRecord(body, 'event')
    console.log('[slack] ignoring event type:', eventRecord ? readString(eventRecord, 'type') : '(none)')
    return
  }

  if (messageEvent.botId) return
  if (messageEvent.subtype && messageEvent.subtype !== 'file_share') return

  const eventId = createMessageEventId(messageEvent)
  if (processedEvents.has(eventId)) {
    console.log(`[slack] skipping duplicate event ${messageEvent.type} ${eventId}`)
    return
  }

  if (messageEvent.type === 'app_mention') {
    processingEvents.delete(eventId)
  } else if (processingEvents.has(eventId)) {
    console.log(`[slack] skipping duplicate event ${messageEvent.type} ${eventId} (in-flight)`)
    return
  }

  processingEvents.add(eventId)

  const conversationId = buildConversationId(messageEvent.channel, messageEvent.threadTs, messageEvent.ts)
  if (messageEvent.threadTs && !activeThreads.has(conversationId) && triggerConfig.thread !== undefined) {
    const participated = await wasBotInThread(slack, messageEvent.channel, messageEvent.threadTs, botUserId)
    if (participated) {
      activeThreads.add(conversationId)
      console.log(`[slack] recovered active thread from history: ${conversationId}`)
    }
  }

  const candidates = selectMessageCandidates(messageEvent, triggerConfig, activeThreads, botUserId)
  if (candidates.length === 0) {
    processingEvents.delete(eventId)
    return
  }

  const userName = await resolveUserName(slack, messageEvent.userId, userNameCache)
  let selected: MessageCandidateSelection | null = null

  try {
    for (const candidate of candidates) {
      const triggerEvent = buildMessageTriggerEvent(candidate.kind, messageEvent, userName, body)
      const selection = await evaluateMessageCandidate(candidate, triggerEvent)
      if (selection) {
        selected = selection
        break
      }
    }
  } catch (err) {
    processingEvents.delete(eventId)
    console.error('[slack] message trigger filter failed:', err)
    return
  }

  if (!selected) {
    processingEvents.delete(eventId)
    return
  }

  try {
    const prompt = await resolvePromptSource(selected.source, promptBaseDir)
    const promptSourceMeta = getPromptSourceMetadata(selected.source)
    const thinkingMessage = resolveThinkingMessage(
      getThinkingMessageOverride(selected.source),
      globalThinkingMessage,
    )
    const inboundText = buildMessageInboundText(prompt, messageEvent.text)
    const disabledTools = getDisabledTools(selected.source)
    const files = messageEvent.files.length > 0
      ? await downloadSlackFiles(messageEvent.files, botToken)
      : undefined
    const inbound: InboundEvent = {
      connector: 'slack',
      conversationId,
      userId: messageEvent.userId,
      userName,
      text: inboundText.fullText,
      userText: inboundText.userText,
      files,
      raw: {
        ...body,
        triggerKind: selected.kind,
        thinkingMessage,
        ...promptSourceMeta,
      },
      disabledTools,
    }

    activeThreads.add(conversationId)
    commitProcessedEvent(processedEvents, processingEvents, eventId)
    await engine.submitTurn(inbound)
  } catch (err) {
    processingEvents.delete(eventId)
    console.error('[slack] failed to process message event:', err)
  }
}

export function slackConnector(options: SlackConnectorOptions): Connector {
  const { botToken, thinkingMessage } = options
  const slack = new WebClient(botToken)
  const userNameCache = new Map<string, string>()
  const activeThreads = new Set<string>()
  const processedEvents = new Set<string>()
  const processingEvents = new Set<string>()
  const triggerConfig = normalizeTriggerConfig(options.triggers)
  let botUserId: string | undefined
  let socketClient: SocketModeClient | undefined
  let promptBaseDir = process.cwd()

  return {
    name: 'slack',

    registerRoutes(server: HttpServer, engine: TurnEngine, context?: ConnectorContext): void {
      promptBaseDir = context?.promptBaseDir ?? process.cwd()

      const resolveBotUserId = async () => {
        if (botUserId) return
        try {
          const auth = await slack.auth.test()
          botUserId = auth.user_id ?? undefined
          console.log(`[slack] resolved bot user id: ${botUserId}`)
        } catch (err) {
          console.warn('[slack] failed to resolve bot user id:', err)
        }
      }

      const mode = options.mode ?? 'http'

      if (mode === 'socket') {
        const { appToken } = options as Extract<SlackConnectorOptions, { mode: 'socket' }>
        socketClient = new SocketModeClient({ appToken })

        const handleSocketEvent = async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
          await ack()
          await resolveBotUserId()
          await processSlackEvent(
            body,
            engine,
            slack,
            botToken,
            userNameCache,
            activeThreads,
            processedEvents,
            processingEvents,
            triggerConfig,
            promptBaseDir,
            botUserId,
            thinkingMessage,
          )
        }

        socketClient.on('app_mention', handleSocketEvent)
        socketClient.on('message', handleSocketEvent)
        socketClient.on('reaction_added', handleSocketEvent)

        socketClient.start().then(() => {
          console.log('[slack] socket mode connected')
        }).catch((err: unknown) => {
          console.error('[slack] socket mode connection failed:', err)
        })
        return
      }

      const { signingSecret } = options as Extract<SlackConnectorOptions, { mode?: 'http' }>
      server.post('/api/slack/events', async (req: unknown, res: unknown) => {
        const request = req as {
          body?: unknown
          rawBody?: string
          headers?: Record<string, string | undefined>
        }
        const response = res as {
          status: (code: number) => {
            json: (data: unknown) => void
            send: (text?: string) => void
          }
        }
        const body = isRecord(request.body) ? request.body : {}

        if (body.type === 'url_verification' && typeof body.challenge === 'string') {
          response.status(200).json({ challenge: body.challenge })
          return
        }

        const headers = request.headers ?? {}
        const timestamp = headers['x-slack-request-timestamp']
        const signature = headers['x-slack-signature']
        const rawBody = request.rawBody ?? JSON.stringify(body)

        if (!timestamp || !signature || !verifySignature(signingSecret, timestamp, rawBody, signature)) {
          console.warn('[slack] signature verification failed')
          response.status(401).send('Invalid signature')
          return
        }

        response.status(200).send('')
        await resolveBotUserId()
        await processSlackEvent(
          body,
          engine,
          slack,
          botToken,
          userNameCache,
          activeThreads,
          processedEvents,
          processingEvents,
          triggerConfig,
          promptBaseDir,
          botUserId,
          thinkingMessage,
        )
      })
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      activeThreads.add(context.conversationId)
      return createSlackOutput(slack, context, thinkingMessage)
    },

    async stop(): Promise<void> {
      if (!socketClient) return
      try {
        socketClient.disconnect()
        console.log('[slack] socket mode disconnected')
      } catch (err) {
        console.warn('[slack] socket mode disconnect failed:', err)
      }
      socketClient = undefined
    },
  }
}

// ─── Output ─────────────────────────────────────────────────────────────────

/**
 * Slack Output with step accumulation.
 *
 * Instead of overwriting a single "thinking" message each time, this output
 * detects step boundaries (each Claude assistant message = one step) and
 * accumulates them into a growing Slack message. When Slack block limits
 * are reached, a new overflow message is created automatically.
 *
 * Step detection: when `showProgress(text)` receives text that does NOT
 * start with the previous text, it means a new assistant message has started
 * (= new step). The previous text is flushed to the completed-steps buffer.
 */
export function createSlackOutput(
  slack: SlackClientLike,
  context: ConnectorOutputContext,
  globalThinkingMessage?: string | false,
): ConnectorOutput {
  const [channel, threadTs] = context.conversationId.split(':')
  const thinkingMessage = resolveThinkingMessage(
    readThinkingMessageFromMetadata(context.metadata),
    globalThinkingMessage,
  )

  // --- Accumulated state ---
  const completedSteps: string[] = [] // Flushed step texts
  let currentText = ''                // Latest progress text (live step)
  let activeTs: string | undefined    // Message ts being updated
  let frozenStepCount = 0             // Steps baked into previous (frozen) messages
  let livePrefixLength = 0            // Plain-text live preview already frozen into previous messages
  let lastRenderTime = 0
  let finalized = false               // true after sendResult/sendError
  let renderPromise: Promise<void> | null = null
  let pendingProgressRender = false
  let trailingRenderTimer: ReturnType<typeof setTimeout> | null = null

  const THROTTLE_MS = 1500
  const MAX_BLOCKS = 45       // Leave headroom below Slack's 50-block limit
  const MAX_TEXT_LENGTH = 2800 // Slack text field limit ~3000 chars; leave buffer
  const LIVE_CHUNK_LENGTH = 2200
  const FINAL_CHUNK_LENGTH = 2600

  // --- Serialize all Slack API calls to prevent race conditions ---
  let apiQueue: Promise<void> = Promise.resolve()
  function enqueue(fn: () => Promise<void>): Promise<void> {
    const p = apiQueue.then(fn).catch(err => console.warn('[slack] enqueued api call failed:', err))
    apiQueue = p
    return p
  }

  function clearTrailingRenderTimer(): void {
    if (!trailingRenderTimer) return
    clearTimeout(trailingRenderTimer)
    trailingRenderTimer = null
  }

  function scheduleTrailingRender(): void {
    if (finalized || trailingRenderTimer || !pendingProgressRender) return
    const delay = activeTs ? Math.max(0, lastRenderTime + THROTTLE_MS - Date.now()) : 0
    trailingRenderTimer = setTimeout(() => {
      trailingRenderTimer = null
      if (finalized || !pendingProgressRender) return
      pendingProgressRender = false
      queueRender().catch(err => console.warn('[slack] trailing render failed:', err))
    }, delay)
  }

  // Post thinking indicator immediately
  if (thinkingMessage && thinkingMessage !== '') {
    enqueue(async () => {
      try {
        const result = await slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          ...createSlackTextPayload(thinkingMessage),
          blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: thinkingMessage, verbatim: true }] }],
        })
        activeTs = result.ts
        lastRenderTime = Date.now()
      } catch (err) {
        console.warn('[slack] thinkingMessage failed:', err)
      }
    })
  }

  /** Detect if incoming text represents a new step (vs streaming continuation) */
  function isNewStep(newText: string): boolean {
    if (!currentText || currentText.length === 0) return false
    if (newText === currentText) return false
    // progress events replace entirely (new assistant message) → different prefix
    // progress.delta events append → new text starts with current text
    return !newText.startsWith(currentText)
  }

  /**
   * Render steps (from `startIdx`) into a Slack payload.
   * Steps are joined with blank lines so separate agent outputs do not visually collapse;
   * markdownToSlack handles
   * mrkdwn conversion, section splitting, and the 1-table-per-message limit.
   */
  function renderSteps(steps: string[], liveText?: string): SlackMessagePayload {
    const parts = [...steps]
    if (liveText?.trim()) {
      parts.push(liveText)
    }
    if (parts.length === 0) return createSlackTextPayload('')
    const combined = parts.join('\n\n')
    return markdownToSlack(combined)
  }

  function renderStepsText(steps: string[], liveText?: string): string {
    const parts = [...steps]
    if (liveText?.trim()) {
      parts.push(liveText)
    }
    return parts.join('\n\n')
  }

  function takeSlackTextChunk(text: string, maxLength: number): { chunk: string, consumed: number } {
    if (text.length <= maxLength) {
      return { chunk: text.trimEnd(), consumed: text.length }
    }

    const newlineBreak = text.lastIndexOf('\n', maxLength)
    const spaceBreak = text.lastIndexOf(' ', maxLength)
    const preferredBreak = Math.max(newlineBreak, spaceBreak)
    const splitAt = preferredBreak >= Math.floor(maxLength * 0.6) ? preferredBreak : maxLength
    const chunk = text.slice(0, splitAt).trimEnd()

    if (!chunk) {
      return { chunk: text.slice(0, maxLength), consumed: maxLength }
    }

    let consumed = splitAt
    while (consumed < text.length && /\s/u.test(text[consumed] ?? '')) {
      consumed += 1
    }

    return { chunk, consumed }
  }

  function splitTextForSlack(text: string, maxLength: number): string[] {
    const source = text.trim()
    if (!source) return []

    const chunks: string[] = []
    let remaining = source

    while (remaining.length > 0) {
      const { chunk, consumed } = takeSlackTextChunk(remaining, maxLength)
      if (!chunk) break
      chunks.push(chunk)
      if (consumed >= remaining.length) break
      remaining = remaining.slice(consumed).trimStart()
    }

    return chunks
  }

  async function updateOrCreateMessage(payload: SlackMessagePayload): Promise<void> {
    if (activeTs) {
      await slack.chat.update({ channel, ts: activeTs, ...payload })
      return
    }

    const result = await slack.chat.postMessage({ channel, thread_ts: threadTs, ...payload })
    activeTs = result.ts
  }

  async function renderFinalInChunks(text: string): Promise<void> {
    const chunks = splitTextForSlack(text, FINAL_CHUNK_LENGTH)
    if (chunks.length === 0) return

    if (activeTs) {
      await slack.chat.update({ channel, ts: activeTs, ...createSlackTextPayload(chunks[0]) })
    } else {
      const result = await slack.chat.postMessage({
        channel,
        thread_ts: threadTs,
        ...createSlackTextPayload(chunks[0]),
      })
      activeTs = result.ts
    }

    for (const chunk of chunks.slice(1)) {
      await slack.chat.postMessage({
        channel,
        thread_ts: threadTs,
        ...createSlackTextPayload(chunk),
      })
    }
  }

  async function renderLivePreview(): Promise<void> {
    const source = renderStepsText(completedSteps, currentText)
    if (!source.trim()) return

    while (livePrefixLength < source.length && /\s/u.test(source[livePrefixLength] ?? '')) {
      livePrefixLength += 1
    }

    let remaining = source.slice(livePrefixLength)
    if (!remaining.trim()) return

    while (remaining.length > 0) {
      const { chunk, consumed } = takeSlackTextChunk(remaining, LIVE_CHUNK_LENGTH)
      if (!chunk.trim()) return

      await updateOrCreateMessage(createSlackTextPayload(chunk))

      if (consumed >= remaining.length) {
        return
      }

      livePrefixLength += consumed
      activeTs = undefined

      while (livePrefixLength < source.length && /\s/u.test(source[livePrefixLength] ?? '')) {
        livePrefixLength += 1
      }
      remaining = source.slice(livePrefixLength)
    }
  }

  async function queueRender(options?: { final?: boolean, urgent?: boolean }): Promise<void> {
    clearTrailingRenderTimer()

    if (renderPromise) {
      if (options?.final || options?.urgent) {
        await renderPromise
        return queueRender(options)
      }
      pendingProgressRender = true
      scheduleTrailingRender()
      return renderPromise
    }

    if (!options?.final) {
      pendingProgressRender = false
    }

    renderPromise = enqueue(async () => {
      await renderMessage(options)
      lastRenderTime = Date.now()
    }).finally(() => {
      renderPromise = null
      if (!options?.final && !finalized && pendingProgressRender) {
        scheduleTrailingRender()
      }
    })

    return renderPromise
  }

  /** Update or create the active Slack message. Handles overflow. */
  async function renderMessage(options?: { final?: boolean, urgent?: boolean }): Promise<void> {
    if (!options?.final) {
      await renderLivePreview()
      return
    }

    // Determine which steps to render in the active message
    const stepsForMessage = completedSteps.slice(frozenStepCount)
    const payload = renderSteps(stepsForMessage)

    if (!payload.text.trim()) return

    const blockCount = payload.blocks?.length ?? 1
    const textLength = payload.text.length

    if (blockCount > MAX_BLOCKS || textLength > MAX_TEXT_LENGTH) {
      await renderFinalInChunks(payload.text)
      return
    }

    // --- Normal update or create ---
    if (activeTs) {
      try {
        await slack.chat.update({ channel, ts: activeTs, ...payload })
      } catch (err) {
        console.warn('[slack] final chat.update failed, switching to chunked final delivery:', err)
        await renderFinalInChunks(payload.text)
      }
    } else {
      try {
        const result = await slack.chat.postMessage({ channel, thread_ts: threadTs, ...payload })
        activeTs = result.ts
      } catch (err) {
        console.warn('[slack] postMessage failed:', err)
      }
    }
  }

  return {
    async showProgress(text: string): Promise<void> {
      if (finalized) return
      if (text === currentText) return

      // Detect step transition
      if (isNewStep(text)) {
        completedSteps.push(currentText)
      }
      currentText = text

      const livePreviewText = renderStepsText(completedSteps, currentText)
      const needsImmediateRender =
        activeTs !== undefined &&
        livePreviewText.slice(Math.min(livePrefixLength, livePreviewText.length)).trimStart().length > LIVE_CHUNK_LENGTH

      // Throttle rendering — steps naturally space out (tool execution takes time),
      // but streaming deltas can fire rapidly.
      if (renderPromise) {
        if (needsImmediateRender) {
          await queueRender({ urgent: true })
          return
        }
        pendingProgressRender = true
        scheduleTrailingRender()
        return
      }

      if (needsImmediateRender) {
        await queueRender({ urgent: true })
        return
      }

      const now = Date.now()
      if (now - lastRenderTime < THROTTLE_MS && activeTs) {
        pendingProgressRender = true
        scheduleTrailingRender()
        return
      }

      await queueRender()
    },

    async sendResult(text: string): Promise<void> {
      finalized = true
      pendingProgressRender = false
      clearTrailingRenderTimer()

      // Flush current progress as a completed step if it differs from the result
      // When progress text is just a growing preview of the final answer,
      // the final answer should replace it rather than appear twice.
      const currentTrimmed = currentText.trim()
      const finalTrimmed = text.trim()
      const isGrowingPreview =
        currentTrimmed.length > 0 &&
        finalTrimmed.length > 0 &&
        (finalTrimmed.startsWith(currentTrimmed) || currentTrimmed.startsWith(finalTrimmed))

      if (livePrefixLength > 0) {
        const continuedFinalText =
          completedSteps.length === 0 && finalTrimmed.startsWith(currentTrimmed)
            ? text.slice(Math.min(livePrefixLength, text.length)).trimStart()
            : text

        completedSteps.length = 0
        currentText = ''

        if (!continuedFinalText.trim()) {
          console.warn('[slack] sendResult skipped: empty continued final text')
          return
        }

        completedSteps.push(continuedFinalText)

        console.log(`[slack] sendResult: channel=${channel}, thread_ts=${threadTs}, liveContinuation=true, text.length=${continuedFinalText.length}`)

        try {
          await queueRender({ final: true })
          console.log(`[slack] sendResult ok: ts=${activeTs}`)
        } catch (err) {
          console.error(`[slack] sendResult render failed:`, err)
        }
        return
      }

      if (currentText && currentTrimmed !== finalTrimmed && !isGrowingPreview) {
        completedSteps.push(currentText)
      }
      currentText = ''

      // Add result as the final step (avoid duplicating the last completed step)
      const lastStep = completedSteps[completedSteps.length - 1]
      if (text.trim() && text.trim() !== lastStep?.trim()) {
        completedSteps.push(text)
      }

      // Guard: no content at all
      if (completedSteps.length === 0) {
        if (!text.trim()) {
          console.warn('[slack] sendResult skipped: empty text and no steps')
          return
        }
        completedSteps.push(text)
      }

      console.log(`[slack] sendResult: channel=${channel}, thread_ts=${threadTs}, steps=${completedSteps.length}, text.length=${text.length}`)

      try {
        await queueRender({ final: true })
        console.log(`[slack] sendResult ok: ts=${activeTs}`)
      } catch (err) {
        console.error(`[slack] sendResult render failed:`, err)
      }
    },

    async sendError(message: string): Promise<void> {
      finalized = true
      pendingProgressRender = false
      clearTrailingRenderTimer()

      if (livePrefixLength > 0) {
        completedSteps.length = 0
        currentText = ''
        completedSteps.push(`:warning: ${message}`)

        await enqueue(async () => {
          try {
            await renderMessage({ final: true })
          } catch (err) {
            console.error(`[slack] sendError render failed:`, err)
          }
        })
        return
      }

      // Flush live progress if any
      if (currentText.trim()) {
        completedSteps.push(currentText)
        currentText = ''
      }

      // Append error as a final segment
      completedSteps.push(`:warning: ${message}`)

      await enqueue(async () => {
        try {
          if (completedSteps.length > 1) {
            // Has accumulated content — render steps + error together
            await renderMessage({ final: true })
          } else {
            // No prior content — simple error message
            if (activeTs) {
              try {
                await slack.chat.update({
                  channel,
                  ts: activeTs,
                  ...createSlackTextPayload(`:warning: ${message}`),
                })
              } catch {
                await slack.chat.postMessage({
                  channel,
                  thread_ts: threadTs,
                  ...createSlackTextPayload(`:warning: ${message}`),
                })
              }
            } else {
              await slack.chat.postMessage({
                channel,
                thread_ts: threadTs,
                ...createSlackTextPayload(`:warning: ${message}`),
              })
            }
          }
        } catch (err) {
          console.error(`[slack] sendError render failed:`, err)
        }
      })
    },

    async dispose(): Promise<void> {
      // If steps were accumulated, keep them visible (useful content).
      // Only delete the message if it's still just the thinking indicator.
      if (completedSteps.length === 0 && !currentText.trim() && activeTs && !finalized) {
        await enqueue(async () => {
          try {
            await slack.chat.delete({ channel, ts: activeTs! })
          } catch {
            // Ignore — message may already be deleted
          }
        })
      }
    },
  }
}
