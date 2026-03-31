/**
 * RelayDurableObject: manages WebSocket connections for a single bot.
 *
 * Each bot gets its own Durable Object instance.
 * Bot runtimes connect via WebSocket; Slack events are dispatched to the connected client.
 */
export class RelayDurableObject implements DurableObject {
  private state: DurableObjectState
  private connections: Set<WebSocket> = new Set()
  private eventCounter = 0

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.state.getWebSockets().forEach((ws) => {
      this.connections.add(ws)
    })
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      return this.handleWebSocket()
    }

    if (url.pathname === '/dispatch' && request.method === 'POST') {
      return this.handleDispatch(request)
    }

    return new Response('not found', { status: 404 })
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    this.state.acceptWebSocket(server)
    this.connections.add(server)

    // Send connected event
    const botId =
      this.state.id.toString()
    server.send(
      JSON.stringify({
        type: 'connected',
        data: { botId, ts: Date.now() },
      }),
    )

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  private async handleDispatch(request: Request): Promise<Response> {
    const event = await request.json()
    const id = String(++this.eventCounter)

    const message = JSON.stringify({
      type: 'slack_event',
      data: event,
      id,
    })

    for (const ws of this.connections) {
      try {
        ws.send(message)
      } catch {
        this.connections.delete(ws)
      }
    }

    return new Response(JSON.stringify({ ok: true, delivered: this.connections.size }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): void {
    // Client messages (e.g., pong) -- no action needed
  }

  webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {
    this.connections.delete(ws)
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    this.connections.delete(ws)
  }
}
