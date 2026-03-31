import { EventSource } from 'eventsource'
import type { Transport } from './types.js'

/**
 * SSE transport using EventSource (for Node.js / SSE-based relay).
 */
export function createSSETransport(url: string): Transport {
  let eventSource: EventSource | null = null
  const listeners = new Map<string, Array<(data: string) => void>>()
  let errorHandler: ((error: unknown) => void) | null = null

  return {
    connect() {
      eventSource = new EventSource(url)

      for (const [event, handlers] of listeners) {
        for (const handler of handlers) {
          eventSource.addEventListener(event, (e: MessageEvent) => {
            handler(e.data)
          })
        }
      }

      eventSource.onerror = (err) => {
        if (errorHandler) errorHandler(err)
      }
    },

    on(event: string, handler: (data: string) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = []
        listeners.set(event, handlers)
      }
      handlers.push(handler)

      // If already connected, add listener immediately
      if (eventSource) {
        eventSource.addEventListener(event, (e: MessageEvent) => {
          handler(e.data)
        })
      }
    },

    onError(handler: (error: unknown) => void) {
      errorHandler = handler
      if (eventSource) {
        eventSource.onerror = handler
      }
    },

    close() {
      if (eventSource) {
        eventSource.close()
        eventSource = null
      }
    },
  }
}
