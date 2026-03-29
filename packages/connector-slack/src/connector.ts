import type { Connector, InboundEvent, ConnectorOutput, ConnectorOutputContext, HttpServer, TurnEngine, FileAttachment } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { SocketModeClient } from '@slack/socket-mode'
import { verifySignature } from './verify.js'
import { markdownToSlack, type SlackMessagePayload } from './mrkdwn.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export type SlackConnectorOptions = {
  appId: string
  botToken: string
  /** Message shown immediately when a turn starts (e.g. ":loading-dots: *세나가 생각중이에요*"). Set to false to disable. */
  thinkingMessage?: string | false
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

export function slackConnector(options: SlackConnectorOptions): Connector {
  const { appId, botToken, thinkingMessage } = options
  const slack = new WebClient(botToken)
  const userNameCache = new Map<string, string>()
  // Track threads the bot has participated in (channel:thread_ts → true)
  const activeThreads = new Set<string>()
  // Deduplicate events — Slack sends both app_mention and message for the same @mention.
  // Two-phase: processingEvents tracks in-flight events (before we know if they'll be handled),
  // processedEvents tracks events that were actually processed to completion.
  const processedEvents = new Set<string>()
  const processingEvents = new Set<string>()
  // Resolved bot user ID (lazy, set on first event)
  let botUserId: string | undefined
  // Socket Mode client reference for stop() lifecycle
  let socketClient: SocketModeClient | undefined

  return {
    name: 'slack',

    registerRoutes(server: HttpServer, engine: TurnEngine): void {
      // Lazily resolve bot user ID
      const resolveBotUserId = async () => {
        if (botUserId) return
        try {
          const auth = await slack.auth.test()
          botUserId = auth.user_id
          console.log(`[slack] resolved bot user id: ${botUserId}`)
        } catch (err) {
          console.warn('[slack] failed to resolve bot user id:', err)
        }
      }

      const mode = options.mode ?? 'http'

      if (mode === 'socket') {
        const { appToken } = options as Extract<SlackConnectorOptions, { mode: 'socket' }>
        socketClient = new SocketModeClient({ appToken })

        // @slack/socket-mode v2 emits events_api messages using the inner event type
        // name (e.g. 'app_mention', 'message', 'reaction_added'), NOT 'events_api'.
        const handleSocketEvent = async ({ body, ack }: { body: Record<string, unknown>; ack: () => Promise<void> }) => {
          // Acknowledge immediately (Socket Mode requires ack within 3 s)
          await ack()
          await resolveBotUserId()
          processSlackEvent(body, engine, appId, slack, botToken, userNameCache, activeThreads, processedEvents, processingEvents, botUserId)
        }
        socketClient.on('app_mention', handleSocketEvent)
        socketClient.on('message', handleSocketEvent)
        socketClient.on('reaction_added', handleSocketEvent)

        // Start connection (fire-and-forget; logs errors internally)
        socketClient.start().then(() => {
          console.log('[slack] socket mode connected')
        }).catch((err: unknown) => {
          console.error('[slack] socket mode connection failed:', err)
        })
      } else {
        // HTTP Events API mode
        const { signingSecret } = options as Extract<SlackConnectorOptions, { mode?: 'http' }>
        server.post('/api/slack/events', async (req: any, res: any) => {
          await resolveBotUserId()

          const body = req.body

          // URL verification challenge
          if (body?.type === 'url_verification') {
            res.status(200).json({ challenge: body.challenge })
            return
          }

          // Verify signature
          const timestamp = req.headers['x-slack-request-timestamp']
          const signature = req.headers['x-slack-signature']
          const rawBody = req.rawBody ?? JSON.stringify(body)

          if (!verifySignature(signingSecret, timestamp, rawBody, signature)) {
            console.warn('[slack] signature verification failed')
            res.status(401).send('Invalid signature')
            return
          }

          // Acknowledge immediately (Slack 3s timeout)
          res.status(200).send()

          processSlackEvent(body, engine, appId, slack, botToken, userNameCache, activeThreads, processedEvents, processingEvents, botUserId)
        })
      }
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      // Mark thread as active when the bot creates output (i.e. responds)
      activeThreads.add(context.conversationId)
      return createSlackOutput(slack, context, thinkingMessage)
    },

    async stop(): Promise<void> {
      if (socketClient) {
        try {
          socketClient.disconnect()
          console.log('[slack] socket mode disconnected')
        } catch (err) {
          console.warn('[slack] socket mode disconnect failed:', err)
        }
        socketClient = undefined
      }
    },
  }
}

// ─── Shared event processing ────────────────────────────────────────────────

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
    cache.set(userId, userId) // cache the fallback to avoid repeated failures
    return userId
  }
}

/**
 * Check if the bot participated in the given thread — either mentioned or
 * posted a message.  Used as a fallback when activeThreads (in-memory) doesn't
 * have the thread (e.g. after a restart).
 */
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
      limit: 50, // check up to 50 messages
    })
    const mentionPattern = `<@${botUserId}>`
    return result.messages?.some(m =>
      m.text?.includes(mentionPattern) || m.user === botUserId,
    ) ?? false
  } catch (err) {
    console.warn(`[slack] failed to check thread history for bot participation:`, err)
    return false
  }
}

/**
 * Shared event processor — works identically for HTTP and Socket Mode payloads.
 * The outer envelope (`body`) has the same shape in both modes.
 */
/** Download Slack files to a local temp directory and return FileAttachments with localPath. */
async function downloadSlackFiles(
  files: any[],
  botToken: string,
): Promise<FileAttachment[]> {
  const dir = join(tmpdir(), 'slack-files')
  await mkdir(dir, { recursive: true })

  return Promise.all(
    files.map(async (f: any): Promise<FileAttachment> => {
      const base: FileAttachment = {
        id: f.id,
        name: f.name,
        mimeType: f.mimetype,
        url: f.url_private,
      }
      if (!f.url_private) return base

      try {
        const response = await fetch(f.url_private, {
          headers: { Authorization: `Bearer ${botToken}` },
        })
        if (!response.ok) {
          console.warn(`[slack] file download failed for ${f.id}: ${response.status}`)
          return base
        }
        const buf = Buffer.from(await response.arrayBuffer())
        const ext = f.name?.includes('.') ? '' : `.${(f.mimetype ?? '').split('/')[1] ?? 'bin'}`
        const localPath = join(dir, `${f.id}_${f.name ?? 'file'}${ext}`)
        await writeFile(localPath, buf)
        console.log(`[slack] downloaded file ${f.id} → ${localPath} (${buf.length} bytes)`)
        return { ...base, localPath }
      } catch (err) {
        console.warn(`[slack] file download error for ${f.id}:`, err)
        return base
      }
    }),
  )
}

async function processSlackEvent(
  body: Record<string, unknown>,
  engine: TurnEngine,
  appId: string,
  slack: WebClient,
  botToken: string,
  userNameCache: Map<string, string>,
  activeThreads: Set<string>,
  processedEvents: Set<string>,
  processingEvents: Set<string>,
  botUserId?: string,
): Promise<void> {
  const event = (body as any)?.event
  if (!event) {
    console.log('[slack] no event in body, type:', (body as any)?.type)
    return
  }

  // Handle reaction_added: :x: emoji aborts in-flight turn
  if (event.type === 'reaction_added' && event.reaction === 'x') {
    const item = event.item
    if (item?.type !== 'message') return

    // Resolve the thread_ts of the reacted-to message
    const channel = item.channel as string
    const messageTs = item.ts as string

    try {
      const result = await slack.conversations.replies({
        channel,
        ts: messageTs,
        limit: 1,
        inclusive: true,
      })
      const msg = result.messages?.[0]
      const threadTs = msg?.thread_ts ?? msg?.ts ?? messageTs
      const conversationId = `${channel}:${threadTs}`

      const aborted = engine.abortConversation(conversationId)
      if (aborted) {
        console.log(`[slack] :x: reaction aborted conversation ${conversationId}`)
        // React with :x: to confirm abort
        try {
          await slack.reactions.add({ channel, name: 'x', timestamp: messageTs })
        } catch { /* ignore */ }
      } else {
        console.log(`[slack] :x: reaction on ${conversationId} — no active turn to abort`)
      }
    } catch (err) {
      console.warn('[slack] failed to handle :x: reaction:', err)
    }
    return
  }

  // Only handle app_mention and message events
  if (event.type !== 'app_mention' && event.type !== 'message') {
    console.log('[slack] ignoring event type:', event.type)
    return
  }
  if (event.bot_id) return // Ignore bot messages
  // Ignore message subtypes (edits, deletes, etc.) but allow file_share (image/file attachments)
  if (event.subtype && event.subtype !== 'file_share') return

  // Deduplicate: Slack sends both app_mention and message for the same @mention.
  // Two-phase approach:
  //   1. processingEvents — claimed immediately (before await) to prevent race conditions
  //   2. processedEvents — committed only after we confirm the event will be handled
  // This prevents the bug where a `message` event claims the eventId, exits early
  // (no thread_ts / inactive thread), and then the subsequent `app_mention` is skipped.
  const eventId = `${event.channel}:${event.ts}`
  if (processedEvents.has(eventId)) {
    console.log(`[slack] skipping duplicate event ${event.type} ${eventId}`)
    return
  }

  // app_mention takes priority — if a message event is currently being processed
  // (in-flight, not yet committed), an app_mention can steal the slot.
  if (event.type === 'app_mention') {
    // Always allow app_mention to proceed — remove any in-flight message claim
    processingEvents.delete(eventId)
  } else if (processingEvents.has(eventId)) {
    // Another event (likely app_mention) is already processing this
    console.log(`[slack] skipping duplicate event ${event.type} ${eventId} (in-flight)`)
    return
  }

  // Claim the slot immediately (before any await) to prevent concurrent duplicates
  processingEvents.add(eventId)

  const threadKey = `${event.channel}:${event.thread_ts ?? event.ts}`

  // For app_mention: always process and track the thread
  if (event.type === 'app_mention') {
    activeThreads.add(threadKey)
  }

  // For message events: only process if it's a reply in an active thread
  if (event.type === 'message') {
    if (!event.thread_ts) {
      // Top-level channel message without mention — ignore
      processingEvents.delete(eventId)
      return
    }
    if (!activeThreads.has(threadKey)) {
      // Thread not tracked in memory — check thread history as fallback (e.g. after restart)
      const participated = await wasBotInThread(slack, event.channel, event.thread_ts, botUserId)
      if (participated) {
        console.log(`[slack] recovered active thread from history: ${threadKey}`)
        activeThreads.add(threadKey)
      } else {
        console.log(`[slack] ignoring thread reply in inactive thread ${threadKey}`)
        processingEvents.delete(eventId)
        return
      }
    }
  }

  // Event will be processed — commit to processedEvents and release processingEvents
  processedEvents.add(eventId)
  processingEvents.delete(eventId)

  // Evict oldest entries when exceeding 500 to prevent unbounded growth
  if (processedEvents.size > 500) {
    const excess = processedEvents.size - 500
    let removed = 0
    for (const entry of processedEvents) {
      if (removed >= excess) break
      processedEvents.delete(entry)
      removed++
    }
  }

  const userId = event.user ?? ''
  const userName = await resolveUserName(slack, userId, userNameCache)
  console.log(`[slack] ${event.type} from ${userName}(${userId}) in ${event.channel} [thread:${event.thread_ts ?? 'none'}]`)

  // Download attached files to local temp directory
  const files: FileAttachment[] | undefined = event.files?.length
    ? await downloadSlackFiles(event.files, botToken)
    : undefined

  const inbound: InboundEvent = {
    connector: 'slack',
    conversationId: threadKey,
    userId,
    userName,
    text: event.text ?? '',
    files,
    raw: body,
  }

  try {
    await engine.submitTurn(inbound)
  } catch (err) {
    console.error('[slack] submitTurn error:', err)
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
function createSlackOutput(
  slack: WebClient,
  context: ConnectorOutputContext,
  thinkingMessage?: string | false,
): ConnectorOutput {
  const [channel, threadTs] = context.conversationId.split(':')

  // --- Accumulated state ---
  const completedSteps: string[] = [] // Flushed step texts
  let currentText = ''                // Latest progress text (live step)
  let activeTs: string | undefined    // Message ts being updated
  let frozenStepCount = 0             // Steps baked into previous (frozen) messages
  let lastRenderTime = 0
  let finalized = false               // true after sendResult/sendError

  const THROTTLE_MS = 1500
  const MAX_BLOCKS = 45       // Leave headroom below Slack's 50-block limit
  const MAX_TEXT_LENGTH = 2800 // Slack text field limit ~3000 chars; leave buffer

  // --- Serialize all Slack API calls to prevent race conditions ---
  let apiQueue: Promise<void> = Promise.resolve()
  function enqueue(fn: () => Promise<void>): Promise<void> {
    const p = apiQueue.then(fn).catch(err => console.warn('[slack] enqueued api call failed:', err))
    apiQueue = p
    return p
  }

  // Post thinking indicator immediately
  if (thinkingMessage && thinkingMessage !== '') {
    enqueue(async () => {
      try {
        const result = await slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text: thinkingMessage,
          blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: thinkingMessage }] }],
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
   * Steps are joined with `---` separators; markdownToSlack handles
   * mrkdwn conversion, section splitting, and the 1-table-per-message limit.
   */
  function renderSteps(steps: string[], liveText?: string): SlackMessagePayload {
    const parts = [...steps]
    if (liveText?.trim()) {
      parts.push(liveText)
    }
    if (parts.length === 0) return { text: '' }
    const combined = parts.join('\n\n---\n\n')
    return markdownToSlack(combined)
  }

  /** Update or create the active Slack message. Handles overflow. */
  async function renderMessage(options?: { final?: boolean }): Promise<void> {
    // Determine which steps to render in the active message
    const stepsForMessage = completedSteps.slice(frozenStepCount)
    const liveText = options?.final ? undefined : currentText
    const payload = renderSteps(stepsForMessage, liveText)

    if (!payload.text.trim()) return

    const blockCount = payload.blocks?.length ?? 1

    // --- Overflow check: block count OR text length ---
    const textLength = payload.text.length
    if (activeTs && (blockCount > MAX_BLOCKS || textLength > MAX_TEXT_LENGTH)) {
      // 1. Freeze the current message with only its completed steps (no live text)
      const frozenPayload = renderSteps(completedSteps.slice(frozenStepCount))
      if (frozenPayload.text.trim()) {
        try {
          await slack.chat.update({ channel, ts: activeTs, ...frozenPayload })
        } catch {
          // Best-effort — old message may stay with stale live text
        }
      }

      // 2. Start a new message with only the latest step(s)
      frozenStepCount = Math.max(0, completedSteps.length - 1)
      const overflowSteps = completedSteps.slice(frozenStepCount)
      const overflowPayload = renderSteps(overflowSteps, liveText)

      // Guard: if even the overflow payload exceeds limits (single huge step),
      // truncate to fit rather than creating an infinite chain of overflow messages
      const overflowBlocks = overflowPayload.blocks?.length ?? 1
      const overflowTextLen = overflowPayload.text.length
      let safePayload: SlackMessagePayload
      if (overflowBlocks > MAX_BLOCKS || overflowTextLen > MAX_TEXT_LENGTH) {
        // Truncate text to fit, strip blocks
        const truncated = overflowPayload.text.slice(0, MAX_TEXT_LENGTH - 20) + '\n\n_(truncated)_'
        safePayload = { text: truncated }
      } else {
        safePayload = overflowPayload
      }

      try {
        const result = await slack.chat.postMessage({
          channel,
          thread_ts: threadTs,
          ...safePayload,
        })
        activeTs = result.ts
        console.log(`[slack] overflow → new message ts=${result.ts}`)
      } catch (err) {
        console.warn('[slack] overflow postMessage failed:', err)
      }
      return
    }

    // --- Normal update or create ---
    if (activeTs) {
      try {
        await slack.chat.update({ channel, ts: activeTs, ...payload })
      } catch (err) {
        console.warn('[slack] chat.update failed, posting new message:', err)
        try {
          const result = await slack.chat.postMessage({ channel, thread_ts: threadTs, ...payload })
          activeTs = result.ts
        } catch (err2) {
          console.warn('[slack] fallback postMessage also failed:', err2)
        }
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

      // Throttle rendering — steps naturally space out (tool execution takes time),
      // but streaming deltas can fire rapidly.
      const now = Date.now()
      if (now - lastRenderTime < THROTTLE_MS && activeTs) return

      await enqueue(async () => {
        await renderMessage()
        lastRenderTime = Date.now()
      })
    },

    async sendResult(text: string): Promise<void> {
      finalized = true

      // Flush current progress as a completed step if it differs from the result
      // Use trimmed comparison to tolerate minor whitespace differences
      if (currentText && currentText.trim() !== text.trim()) {
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

      await enqueue(async () => {
        try {
          await renderMessage({ final: true })
          console.log(`[slack] sendResult ok: ts=${activeTs}`)
        } catch (err) {
          console.error(`[slack] sendResult render failed:`, err)
        }
      })
    },

    async sendError(message: string): Promise<void> {
      finalized = true

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
                  text: `:warning: ${message}`,
                })
              } catch {
                await slack.chat.postMessage({
                  channel,
                  thread_ts: threadTs,
                  text: `:warning: ${message}`,
                })
              }
            } else {
              await slack.chat.postMessage({
                channel,
                thread_ts: threadTs,
                text: `:warning: ${message}`,
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
