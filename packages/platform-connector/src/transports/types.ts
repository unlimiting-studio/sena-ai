/**
 * Transport interface for platform connector.
 * Abstracts SSE (Node.js) and WebSocket (CF Workers) connections.
 */
export interface Transport {
  /** Connect to the platform relay. */
  connect(): void
  /** Register an event listener. */
  on(event: string, handler: (data: string) => void): void
  /** Register an error handler. */
  onError(handler: (error: unknown) => void): void
  /** Close the connection. */
  close(): void
}

export type TransportFactory = (url: string) => Transport
