import type { Connector, InboundEvent, ConnectorOutput, ConnectorOutputContext, HttpServer, TurnEngine } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { verifySignature } from './verify.js'

export type SlackConnectorOptions = {
  appId: string
  botToken: string
  signingSecret: string
  /** Message shown immediately when a turn starts (e.g. ":loading-dots: *세나가 생각중이에요*"). Set to false to disable. */
  thinkingMessage?: string | false
}

export function slackConnector(options: SlackConnectorOptions): Connector {
  const { appId, botToken, signingSecret, thinkingMessage } = options
  const slack = new WebClient(botToken)
  const userNameCache = new Map<string, string>()
  // Track threads the bot has participated in (channel:thread_ts → true)
  const activeThreads = new Set<string>()

  return {
    name: 'slack',

    registerRoutes(server: HttpServer, engine: TurnEngine): void {
      server.post('/api/slack/events', (req: any, res: any) => {
        handleSlackEvent(req, res, engine, signingSecret, appId, slack, userNameCache, activeThreads)
      })
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      // Mark thread as active when the bot creates output (i.e. responds)
      activeThreads.add(context.conversationId)
      return createSlackOutput(slack, context, thinkingMessage)
    },
  }
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
    cache.set(userId, userId) // cache the fallback to avoid repeated failures
    return userId
  }
}

async function handleSlackEvent(
  req: any,
  res: any,
  engine: TurnEngine,
  signingSecret: string,
  appId: string,
  slack: WebClient,
  userNameCache: Map<string, string>,
  activeThreads: Set<string>,
): Promise<void> {
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

  // Process event
  const event = body?.event
  if (!event) {
    console.log('[slack] no event in body, type:', body?.type)
    return
  }

  // Only handle app_mention and message events
  if (event.type !== 'app_mention' && event.type !== 'message') {
    console.log('[slack] ignoring event type:', event.type)
    return
  }
  if (event.bot_id) return // Ignore bot messages
  if (event.subtype) return // Ignore message subtypes (edits, deletes, etc.)

  const threadKey = `${event.channel}:${event.thread_ts ?? event.ts}`

  // For app_mention: always process and track the thread
  if (event.type === 'app_mention') {
    activeThreads.add(threadKey)
  }

  // For message events: only process if it's a reply in an active thread
  if (event.type === 'message') {
    if (!event.thread_ts) {
      // Top-level channel message without mention — ignore
      return
    }
    if (!activeThreads.has(threadKey)) {
      // Thread reply, but bot was never mentioned in this thread — ignore
      console.log(`[slack] ignoring thread reply in inactive thread ${threadKey}`)
      return
    }
  }

  const userId = event.user ?? ''
  const userName = await resolveUserName(slack, userId, userNameCache)
  console.log(`[slack] ${event.type} from ${userName}(${userId}) in ${event.channel} [thread:${event.thread_ts ?? 'none'}]`)

  const inbound: InboundEvent = {
    connector: 'slack',
    conversationId: threadKey,
    userId,
    userName,
    text: event.text ?? '',
    files: event.files?.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimetype,
      url: f.url_private,
    })),
    raw: body,
  }

  try {
    await engine.submitTurn(inbound)
  } catch (err) {
    console.error('[slack] submitTurn error:', err)
  }
}

function createSlackOutput(
  slack: WebClient,
  context: ConnectorOutputContext,
  thinkingMessage?: string | false,
): ConnectorOutput {
  // conversationId format: "channel:thread_ts"
  const [channel, threadTs] = context.conversationId.split(':')
  let progressTs: string | undefined
  let lastProgressTime = 0
  const THROTTLE_MS = 1500

  // Send thinking indicator immediately on creation (context block = small text, like v1)
  if (thinkingMessage && thinkingMessage !== '') {
    slack.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: thinkingMessage,
      blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text: thinkingMessage }] }],
    })
      .then(r => { progressTs = r.ts; lastProgressTime = Date.now() })
      .catch(() => {})
  }

  return {
    async showProgress(text: string): Promise<void> {
      const now = Date.now()
      if (now - lastProgressTime < THROTTLE_MS && progressTs) return

      try {
        if (progressTs) {
          await slack.chat.update({ channel, ts: progressTs, text: `_${text}_` })
        } else {
          const result = await slack.chat.postMessage({ channel, thread_ts: threadTs, text: `_${text}_` })
          progressTs = result.ts
        }
        lastProgressTime = now
      } catch {
        // Swallow progress errors
      }
    },

    async sendResult(text: string): Promise<void> {
      // Delete progress/thinking message if exists
      if (progressTs) {
        try {
          await slack.chat.delete({ channel, ts: progressTs })
        } catch {
          // Ignore
        }
      }

      console.log(`[slack] sendResult: channel=${channel}, thread_ts=${threadTs}, text.length=${text.length}`)
      try {
        const result = await slack.chat.postMessage({ channel, thread_ts: threadTs, text })
        console.log(`[slack] sendResult ok: ts=${result.ts}, ok=${result.ok}`)
      } catch (err) {
        console.error(`[slack] sendResult failed:`, err)
        throw err
      }
    },

    async sendError(message: string): Promise<void> {
      // Delete progress/thinking message if exists
      if (progressTs) {
        try {
          await slack.chat.delete({ channel, ts: progressTs })
        } catch {
          // Ignore
        }
        progressTs = undefined
      }

      await slack.chat.postMessage({ channel, thread_ts: threadTs, text: `:warning: ${message}` })
    },

    async dispose(): Promise<void> {
      if (progressTs) {
        try {
          await slack.chat.delete({ channel, ts: progressTs })
        } catch {
          // Ignore
        }
      }
    },
  }
}
