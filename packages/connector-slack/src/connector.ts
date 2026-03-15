import type { Connector, InboundEvent, ConnectorOutput, ConnectorOutputContext, HttpServer, TurnEngine } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { verifySignature } from './verify.js'

export type SlackConnectorOptions = {
  appId: string
  botToken: string
  signingSecret: string
}

export function slackConnector(options: SlackConnectorOptions): Connector {
  const { appId, botToken, signingSecret } = options
  const slack = new WebClient(botToken)

  return {
    name: 'slack',

    registerRoutes(server: HttpServer, engine: TurnEngine): void {
      server.post('/slack/events', (req: any, res: any) => {
        handleSlackEvent(req, res, engine, signingSecret, appId)
      })
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      return createSlackOutput(slack, context)
    },
  }
}

async function handleSlackEvent(
  req: any,
  res: any,
  engine: TurnEngine,
  signingSecret: string,
  appId: string,
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
    res.status(401).send('Invalid signature')
    return
  }

  // Acknowledge immediately (Slack 3s timeout)
  res.status(200).send()

  // Process event
  const event = body?.event
  if (!event) return

  // Only handle app_mention and message events directed at the bot
  if (event.type !== 'app_mention' && event.type !== 'message') return
  if (event.bot_id) return // Ignore bot messages
  if (event.subtype) return // Ignore message subtypes (edits, deletes, etc.)

  const inbound: InboundEvent = {
    connector: 'slack',
    conversationId: event.thread_ts ?? event.ts, // Use thread ts as conversation ID
    userId: event.user ?? '',
    userName: event.user ?? '',
    text: event.text ?? '',
    files: event.files?.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimetype,
      url: f.url_private,
    })),
    raw: body,
  }

  await engine.submitTurn(inbound)
}

function createSlackOutput(slack: WebClient, context: ConnectorOutputContext): ConnectorOutput {
  let progressTs: string | undefined
  let lastProgressTime = 0
  const THROTTLE_MS = 1500

  return {
    async showProgress(text: string): Promise<void> {
      const now = Date.now()
      if (now - lastProgressTime < THROTTLE_MS && progressTs) return

      try {
        if (progressTs) {
          await slack.chat.update({
            channel: context.conversationId.split(':')[0] || context.conversationId,
            ts: progressTs,
            text: `_${text}_`,
          })
        } else {
          const result = await slack.chat.postMessage({
            channel: context.conversationId.split(':')[0] || context.conversationId,
            thread_ts: context.conversationId,
            text: `_${text}_`,
          })
          progressTs = result.ts
        }
        lastProgressTime = now
      } catch {
        // Swallow progress errors
      }
    },

    async sendResult(text: string): Promise<void> {
      // Delete progress message if exists
      if (progressTs) {
        try {
          await slack.chat.delete({
            channel: context.conversationId.split(':')[0] || context.conversationId,
            ts: progressTs,
          })
        } catch {
          // Ignore
        }
      }

      await slack.chat.postMessage({
        channel: context.conversationId.split(':')[0] || context.conversationId,
        thread_ts: context.conversationId,
        text,
      })
    },

    async sendError(message: string): Promise<void> {
      await slack.chat.postMessage({
        channel: context.conversationId.split(':')[0] || context.conversationId,
        thread_ts: context.conversationId,
        text: `:warning: ${message}`,
      })
    },

    async dispose(): Promise<void> {
      // Clean up progress message
      if (progressTs) {
        try {
          await slack.chat.delete({
            channel: context.conversationId.split(':')[0] || context.conversationId,
            ts: progressTs,
          })
        } catch {
          // Ignore
        }
      }
    },
  }
}
