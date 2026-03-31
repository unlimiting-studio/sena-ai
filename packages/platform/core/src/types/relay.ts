import type { Context } from 'hono'

/**
 * RelayHub interface: manages connections between the platform and local bot runtimes.
 * Node.js uses SSE, CF Workers uses WebSocket via Durable Objects.
 */
export interface RelayHub {
  /** Handle a new streaming connection from a bot runtime. */
  handleStream(c: Context, botId: string, connectKey: string): Promise<Response>
  /** Dispatch a Slack event to the connected bot runtime. */
  dispatch(botId: string, event: unknown): boolean
  /** Check if a specific bot is connected. */
  isConnected(botId: string): boolean
  /** List all connected bot IDs. */
  connectedBots(): string[]
}
