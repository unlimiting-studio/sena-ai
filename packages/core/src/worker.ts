import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ResolvedSenaConfig } from './config.js'
import type { Connector, HttpServer, InboundEvent, SessionStore, TurnEngine } from './types.js'
import { createTurnEngine } from './engine.js'

export type WorkerOptions = {
  config: ResolvedSenaConfig
  port?: number
  sessionStore?: SessionStore
}

/** Simple in-memory session store (conversationId → SDK sessionId) */
function createInMemorySessionStore(): SessionStore {
  const map = new Map<string, string>()
  return {
    async get(conversationId) { return map.get(conversationId) ?? null },
    async set(conversationId, sessionId) { map.set(conversationId, sessionId) },
    async delete(conversationId) { map.delete(conversationId) },
  }
}

/**
 * Creates and starts a Worker that runs connectors, hooks, runtime, and scheduler.
 */
export function createWorker(options: WorkerOptions) {
  const { config, port = parseInt(process.env.SENA_WORKER_PORT ?? '0', 10) } = options
  const sessionStore = options.sessionStore ?? createInMemorySessionStore()
  let server: Server | null = null

  const engine = createTurnEngine({
    name: config.name,
    cwd: config.cwd,
    runtime: config.runtime,
    hooks: config.hooks,
    tools: config.tools,
  })

  // Build a TurnEngine adapter that connectors use
  const connectorMap = new Map<string, Connector>()
  for (const c of config.connectors ?? []) {
    connectorMap.set(c.name, c)
  }

  const turnEngine: TurnEngine = {
    async submitTurn(event: InboundEvent): Promise<void> {
      // Create output for the originating connector
      const connector = connectorMap.get(event.connector)
      if (!connector) {
        console.error(`[worker] connector not found: "${event.connector}" (registered: ${[...connectorMap.keys()].join(', ')})`)
        return
      }
      const output = connector.createOutput({
        conversationId: event.conversationId,
        connector: event.connector,
      })

      try {
        // Look up existing session for this conversation
        const existingSessionId = await sessionStore.get(event.conversationId)
        if (existingSessionId) {
          console.log(`[worker] resuming session ${existingSessionId.slice(0, 8)} for ${event.conversationId}`)
        }

        const trace = await engine.processTurn({
          input: event.text,
          trigger: 'connector',
          sessionId: existingSessionId,
          connector: {
            name: event.connector,
            conversationId: event.conversationId,
            userId: event.userId,
            userName: event.userName,
            files: event.files,
            raw: event.raw,
          },
          onEvent: output ? (evt) => {
            if (evt.type === 'progress' || evt.type === 'progress.delta') {
              output.showProgress(evt.text).catch(() => {})
            }
          } : undefined,
        })

        // Save session ID for future turns in this conversation
        if (trace.result?.sessionId) {
          await sessionStore.set(event.conversationId, trace.result.sessionId)
          console.log(`[worker] saved session ${trace.result.sessionId.slice(0, 8)} for ${event.conversationId}`)
        }

        // Send result or error to the connector
        if (trace.result) {
          console.log(`[worker] sending result to ${event.connector} (${trace.result.text.length}ch)`)
          await output.sendResult(trace.result.text)
          console.log(`[worker] result sent`)
        } else if (trace.error) {
          console.log(`[worker] sending error to ${event.connector}: ${trace.error}`)
          await output.sendError(trace.error)
        } else {
          console.warn(`[worker] turn finished but no result and no error`)
        }
      } catch (err) {
        console.error(`[worker] submitTurn error:`, err)
        try {
          await output.sendError(err instanceof Error ? err.message : String(err))
        } catch (sendErr) {
          console.error(`[worker] sendError also failed:`, sendErr)
        }
      } finally {
        await output.dispose()
      }
    },
  }

  // Simple HTTP server adapter
  const routes: { method: string; path: string; handler: (req: any, res: any) => void }[] = []

  const httpServer: HttpServer = {
    post(path: string, handler: (req: any, res: any) => void) {
      routes.push({ method: 'POST', path, handler })
    },
  }

  // Register connector routes
  for (const connector of config.connectors) {
    connector.registerRoutes(httpServer, turnEngine)
  }

  async function start(): Promise<void> {
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Parse body for POST requests
      if (req.method === 'POST') {
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          chunks.push(chunk as Buffer)
        }
        const rawBody = Buffer.concat(chunks).toString()
        try {
          ;(req as any).body = JSON.parse(rawBody)
          ;(req as any).rawBody = rawBody
        } catch {
          ;(req as any).body = rawBody
          ;(req as any).rawBody = rawBody
        }
      }

      // Route matching
      const route = routes.find(r => r.method === req.method && req.url?.startsWith(r.path))
      if (route) {
        // Wrap res with helpers
        const wrappedRes = Object.assign(res, {
          status(code: number) {
            res.statusCode = code
            return {
              json(data: unknown) {
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(data))
              },
              send(text: string) {
                res.end(text)
              },
            }
          },
        })
        route.handler(req, wrappedRes)
        return
      }

      // Health check
      if (req.url === '/health') {
        res.writeHead(200)
        res.end('ok')
        return
      }

      res.writeHead(404)
      res.end('Not Found')
    })

    server.listen(port, () => {
      const actualPort = (server!.address() as any)?.port ?? port
      // Notify orchestrator that we're ready, include actual port (important when port=0)
      if (process.send) {
        process.send({ type: 'ready', port: actualPort })
      }
    })
  }

  async function stop(): Promise<void> {
    server?.close()
  }

  // Listen for drain signal from orchestrator
  process.on('message', (msg: any) => {
    if (msg?.type === 'drain') {
      stop()
    }
  })

  return { start, stop, engine }
}
