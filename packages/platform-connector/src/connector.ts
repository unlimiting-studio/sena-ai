import type {
  Connector,
  ConnectorOutput,
  ConnectorOutputContext,
  HttpServer,
  InboundEvent,
  TurnEngine,
} from '@sena-ai/core'
import type { Transport } from './transports/types.js'
import { createSSETransport } from './transports/sse.js'
import { createWebSocketTransport } from './transports/websocket.js'

export type TransportType = 'sse' | 'websocket' | 'auto'

export type PlatformConnectorOptions = {
  /** Platform server URL (e.g. https://platform.example.com) */
  platformUrl: string
  /** connect_key -- platform-issued authentication key */
  connectKey: string
  /** Thinking message (optional) */
  thinkingMessage?: string
  /** Transport type: 'websocket' (default), 'sse', or 'auto' */
  transport?: TransportType
}

/**
 * Platform Connector: connects to the platform via SSE or WebSocket.
 *
 * - Receives Slack events from the platform relay
 * - Calls Slack API via the platform's HTTP proxy
 *
 * No Slack tokens needed locally (zero token exposure principle).
 */
export function platformConnector(options: PlatformConnectorOptions): Connector {
  const { platformUrl, connectKey, thinkingMessage } = options
  const transportType = options.transport ?? 'websocket'
  const baseUrl = platformUrl.replace(/\/$/, '')

  let transport: Transport | null = null
  let engine: TurnEngine | null = null

  /**
   * Call Slack API via platform proxy.
   */
  async function callSlackApi(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${baseUrl}/relay/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-connect-key': connectKey,
      },
      body: JSON.stringify({ method, params }),
    })
    return (await res.json()) as Record<string, unknown>
  }

  /**
   * Convert Slack event to InboundEvent.
   * Ignores bot messages and messages with subtypes.
   */
  function toInboundEvent(
    slackEvent: Record<string, unknown>,
  ): InboundEvent | null {
    const event = slackEvent.event as Record<string, unknown> | undefined
    if (!event) return null

    const type = event.type as string
    const subtype = event.subtype as string | undefined
    const botId = event.bot_id as string | undefined

    // Ignore bot's own messages
    if (botId) return null
    // Ignore message subtypes (join, leave, etc.)
    if (type === 'message' && subtype) return null

    const channel = event.channel as string
    const threadTs = (event.thread_ts as string) || (event.ts as string)
    const text = (event.text as string) || ''
    const user = (event.user as string) || 'unknown'

    // Handle both app_mention and message
    if (type !== 'app_mention' && type !== 'message') return null

    return {
      connector: 'platform',
      conversationId: `${channel}:${threadTs}`,
      userId: user,
      userName: user,
      text,
      raw: slackEvent,
    }
  }

  function createTransport(): Transport {
    const streamUrl = `${baseUrl}/relay/stream?connect_key=${encodeURIComponent(connectKey)}`

    if (transportType === 'websocket') {
      return createWebSocketTransport(streamUrl)
    }
    if (transportType === 'auto') {
      // Auto-detect: prefer WebSocket (required for CF Workers relay)
      return createWebSocketTransport(streamUrl)
    }
    return createSSETransport(streamUrl)
  }

  return {
    name: 'platform',

    registerRoutes(_server: HttpServer, turnEngine: TurnEngine) {
      engine = turnEngine

      transport = createTransport()

      transport.on('connected', (data: string) => {
        const parsed = JSON.parse(data) as Record<string, unknown>
        console.log(`[platform] connected to platform (botId: ${parsed.botId})`)
      })

      transport.on('slack_event', (data: string) => {
        const slackEvent = JSON.parse(data) as Record<string, unknown>
        const inbound = toInboundEvent(slackEvent)
        if (inbound) {
          engine?.submitTurn(inbound).catch((err: unknown) => {
            console.error('[platform] submitTurn error:', err)
          })
        }
      })

      transport.on('ping', () => {
        // Keepalive -- no action needed
      })

      transport.onError((err) => {
        console.error('[platform] transport error, will auto-reconnect:', err)
      })

      transport.connect()
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      const [channel, threadTs] = context.conversationId.split(':')
      let thinkingTs: string | null = null

      return {
        async showProgress(_text: string) {
          if (thinkingMessage && !thinkingTs) {
            const res = await callSlackApi('chat.postMessage', {
              channel,
              thread_ts: threadTs,
              text: thinkingMessage,
            })
            thinkingTs = (res as Record<string, unknown>).ts as string
          }
        },

        async sendResult(text: string) {
          if (thinkingTs) {
            await callSlackApi('chat.update', {
              channel,
              ts: thinkingTs,
              text,
            })
          } else {
            await callSlackApi('chat.postMessage', {
              channel,
              thread_ts: threadTs,
              text,
            })
          }
        },

        async sendError(message: string) {
          const errorText = `\u26a0\ufe0f ${message}`
          if (thinkingTs) {
            await callSlackApi('chat.update', {
              channel,
              ts: thinkingTs,
              text: errorText,
            })
          } else {
            await callSlackApi('chat.postMessage', {
              channel,
              thread_ts: threadTs,
              text: errorText,
            })
          }
        },

        async dispose() {
          // Cleanup -- sendResult already handled thinking message update
        },
      }
    },

    async stop() {
      if (transport) {
        transport.close()
        transport = null
        console.log('[platform] transport connection closed')
      }
    },
  }
}
