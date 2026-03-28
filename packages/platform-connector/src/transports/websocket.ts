import type { Transport } from './types.js'

/**
 * WebSocket transport (for CF Workers / Durable Objects-based relay).
 */
export function createWebSocketTransport(url: string): Transport {
  let ws: WebSocket | null = null
  const listeners = new Map<string, Array<(data: string) => void>>()
  let errorHandler: ((error: unknown) => void) | null = null

  function dispatchMessage(raw: string) {
    try {
      const msg = JSON.parse(raw) as {
        type: string
        data: unknown
        id?: string
      }
      const handlers = listeners.get(msg.type)
      if (handlers) {
        const dataStr =
          typeof msg.data === 'string'
            ? msg.data
            : JSON.stringify(msg.data)
        for (const handler of handlers) {
          handler(dataStr)
        }
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  return {
    connect() {
      // Convert http(s) to ws(s)
      const wsUrl = url.replace(/^http/, 'ws')
      ws = new WebSocket(wsUrl)

      ws.onmessage = (event: MessageEvent) => {
        const data =
          typeof event.data === 'string'
            ? event.data
            : String(event.data)
        dispatchMessage(data)
      }

      ws.onerror = (event) => {
        if (errorHandler) errorHandler(event)
      }

      ws.onclose = () => {
        // Could implement auto-reconnect here
      }
    },

    on(event: string, handler: (data: string) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = []
        listeners.set(event, handlers)
      }
      handlers.push(handler)
    },

    onError(handler: (error: unknown) => void) {
      errorHandler = handler
      if (ws) {
        ws.onerror = handler
      }
    },

    close() {
      if (ws) {
        ws.close()
        ws = null
      }
    },
  }
}
