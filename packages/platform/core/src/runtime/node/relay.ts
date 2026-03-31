import type { Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { RelayHub } from '../../types/relay.js'

type SSEClient = {
  botId: string
  connectKey: string
  send: (event: string, data: string, id?: string) => void
  close: () => void
}

/**
 * SSE-based RelayHub implementation for Node.js.
 */
export function createNodeRelay(): RelayHub {
  // botId -> SSEClient (1 bot = 1 active connection)
  const clients = new Map<string, SSEClient>()

  let eventCounter = 0

  return {
    async handleStream(
      c: Context,
      botId: string,
      connectKey: string,
    ): Promise<Response> {
      return streamSSE(c, async (stream) => {
        // Replace existing connection (reconnect scenario)
        const existing = clients.get(botId)
        if (existing) {
          existing.close()
        }

        let closed = false

        const client: SSEClient = {
          botId,
          connectKey,
          send(event, data, id) {
            if (closed) return
            stream.writeSSE({ event, data, id }).catch(() => {
              closed = true
            })
          },
          close() {
            closed = true
          },
        }

        clients.set(botId, client)

        // Connection confirmation event
        client.send('connected', JSON.stringify({ botId, ts: Date.now() }))

        // Heartbeat (every 30 seconds)
        const heartbeatInterval = setInterval(() => {
          if (closed) {
            clearInterval(heartbeatInterval)
            return
          }
          client.send('ping', JSON.stringify({ ts: Date.now() }))
        }, 30_000)

        // Wait for connection close
        stream.onAbort(() => {
          closed = true
          clearInterval(heartbeatInterval)
          clients.delete(botId)
        })

        // Keep connection alive until aborted
        while (!closed) {
          await new Promise((r) => setTimeout(r, 1000))
        }

        clearInterval(heartbeatInterval)
        clients.delete(botId)
      }) as unknown as Response
    },

    dispatch(botId: string, event: unknown): boolean {
      const client = clients.get(botId)
      if (!client) return false

      const id = String(++eventCounter)
      client.send('slack_event', JSON.stringify(event), id)
      return true
    },

    isConnected(botId: string): boolean {
      return clients.has(botId)
    },

    connectedBots(): string[] {
      return Array.from(clients.keys())
    },
  }
}
