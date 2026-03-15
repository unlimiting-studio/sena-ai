import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { ResolvedSenaConfig } from './config.js'
import type { Connector, HttpServer, InboundEvent, TurnEngine } from './types.js'
import { createTurnEngine } from './engine.js'

export type WorkerOptions = {
  config: ResolvedSenaConfig
  port?: number
}

/**
 * Creates and starts a Worker that runs connectors, hooks, runtime, and scheduler.
 */
export function createWorker(options: WorkerOptions) {
  const { config, port = parseInt(process.env.SENA_WORKER_PORT ?? '0', 10) } = options
  let server: Server | null = null

  const engine = createTurnEngine({
    name: config.name,
    runtime: config.runtime,
    hooks: config.hooks,
    tools: config.tools,
  })

  // Build a TurnEngine adapter that connectors use
  const turnEngine: TurnEngine = {
    async submitTurn(event: InboundEvent): Promise<void> {
      await engine.processTurn({
        input: event.text,
        trigger: 'connector',
        connector: {
          name: event.connector,
          conversationId: event.conversationId,
          userId: event.userId,
          userName: event.userName,
          files: event.files,
          raw: event.raw,
        },
      })
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
