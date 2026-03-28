import type { Transport } from './types.js'
import { createWebSocketTransport } from './websocket.js'
import { createSSETransport } from './sse.js'

/**
 * Auto-detect transport: tries WebSocket first, falls back to SSE.
 *
 * - CF Workers relay only supports WebSocket (returns 426 for SSE)
 * - Node.js relay only supports SSE
 * - Auto mode probes WebSocket and falls back transparently
 */
export function createAutoTransport(url: string): Transport {
  let activeTransport: Transport | null = null
  let resolved = false
  const pendingListeners: Array<{ event: string; handler: (data: string) => void }> = []
  let pendingErrorHandler: ((error: unknown) => void) | null = null

  function applyListeners(transport: Transport) {
    for (const { event, handler } of pendingListeners) {
      transport.on(event, handler)
    }
    if (pendingErrorHandler) {
      transport.onError(pendingErrorHandler)
    }
  }

  return {
    connect() {
      // Try WebSocket first
      const wsTransport = createWebSocketTransport(url)
      applyListeners(wsTransport)

      // Override error handler to detect 426 and fall back
      wsTransport.onError((err: unknown) => {
        // Check for 426 or connection failure indicating WS not supported
        const isUpgradeError =
          err instanceof Error
            ? err.message.includes('426')
            : typeof err === 'object' &&
              err !== null &&
              'code' in err &&
              (err as { code: number }).code === 426

        if (!resolved && isUpgradeError) {
          console.log('[platform] WebSocket not supported, falling back to SSE')
          wsTransport.close()

          const sseTransport = createSSETransport(url)
          applyListeners(sseTransport)
          activeTransport = sseTransport
          resolved = true
          sseTransport.connect()
          return
        }

        // Not a fallback-worthy error — forward to user handler
        if (pendingErrorHandler) {
          pendingErrorHandler(err)
        }
      })

      activeTransport = wsTransport
      resolved = true
      wsTransport.connect()
    },

    on(event: string, handler: (data: string) => void) {
      pendingListeners.push({ event, handler })
      if (activeTransport) {
        activeTransport.on(event, handler)
      }
    },

    onError(handler: (error: unknown) => void) {
      pendingErrorHandler = handler
      if (activeTransport) {
        activeTransport.onError(handler)
      }
    },

    close() {
      if (activeTransport) {
        activeTransport.close()
        activeTransport = null
      }
    },
  }
}
