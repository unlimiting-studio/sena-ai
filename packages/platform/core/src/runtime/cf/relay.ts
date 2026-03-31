import type { Context } from 'hono'
import type { RelayHub } from '../../types/relay.js'

/**
 * Durable Objects-based RelayHub for CF Workers.
 *
 * This stub communicates with a Durable Object namespace.
 * Each bot gets its own Durable Object instance that manages WebSocket connections.
 *
 * The actual Durable Object class (RelayDurableObject) is exported from apps/worker.
 */
export function createCfRelay(doNamespace: DurableObjectNamespace): RelayHub {
  function getStub(botId: string): DurableObjectStub {
    const id = doNamespace.idFromName(botId)
    return doNamespace.get(id)
  }

  return {
    async handleStream(
      c: Context,
      botId: string,
      _connectKey: string,
    ): Promise<Response> {
      const upgradeHeader = c.req.header('Upgrade')
      if (upgradeHeader !== 'websocket') {
        return c.json(
          { error: 'expected websocket upgrade' },
          { status: 426 },
        )
      }

      // Forward the WebSocket upgrade request to the Durable Object
      const stub = getStub(botId)
      const url = new URL(c.req.url)
      url.pathname = '/ws'
      url.searchParams.set('botId', botId)

      return stub.fetch(url.toString(), {
        headers: c.req.raw.headers,
      }) as unknown as Response
    },

    dispatch(botId: string, event: unknown): boolean {
      // Fire and forget -- send event to the DO
      const stub = getStub(botId)
      const url = new URL('https://internal/dispatch')
      url.searchParams.set('botId', botId)

      stub
        .fetch(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
        })
        .catch((err: unknown) => {
          console.error(`[cf-relay] dispatch error for bot ${botId}:`, err)
        })

      // We return true optimistically; the DO handles delivery
      return true
    },

    isConnected(_botId: string): boolean {
      // In CF Workers, we cannot synchronously check DO state
      // This is best-effort
      return true
    },

    connectedBots(): string[] {
      // Cannot enumerate Durable Objects synchronously
      return []
    },
  }
}
