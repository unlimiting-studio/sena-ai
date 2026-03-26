import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { ResolvedSenaConfig } from './config.js'
import type { Connector, HttpServer, InboundEvent, SessionStore, TurnEngine } from './types.js'
import { createTurnEngine } from './engine.js'
import { createScheduler } from './scheduler.js'

export type WorkerOptions = {
  config: ResolvedSenaConfig
  port?: number
  sessionStore?: SessionStore
}

/** File-backed session store that survives restarts */
export function createFileSessionStore(filePath: string): SessionStore {
  let data: Record<string, string> = {}

  // Load existing data
  try {
    data = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    // File doesn't exist yet — that's fine
  }

  function persist() {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      writeFileSync(filePath, JSON.stringify(data, null, 2))
    } catch (err) {
      console.error(`[session-store] failed to persist: ${err}`)
    }
  }

  return {
    async get(conversationId) { return data[conversationId] ?? null },
    async set(conversationId, sessionId) { data[conversationId] = sessionId; persist() },
    async delete(conversationId) { delete data[conversationId]; persist() },
  }
}

/** Simple in-memory session store (fallback) */
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
  const sessionStore = options.sessionStore
    ?? (config.cwd
      ? createFileSessionStore(resolve(config.cwd, '.sessions.json'))
      : createInMemorySessionStore())
  let server: Server | null = null

  const engine = createTurnEngine({
    name: config.name,
    cwd: config.cwd,
    runtime: config.runtime,
    hooks: config.hooks,
    tools: config.tools,
  })

  // Start scheduler for heartbeat/cron schedules (runs as separate conversations)
  const scheduler = config.schedules?.length
    ? createScheduler({
        schedules: config.schedules,
        onTurn: (turnOptions) => engine.processTurn(turnOptions),
      })
    : null

  // Build a TurnEngine adapter that connectors use
  const connectorMap = new Map<string, Connector>()
  for (const c of config.connectors ?? []) {
    connectorMap.set(c.name, c)
  }

  // Per-conversation state: tracks active turns and pending messages for steer.
  // When a turn is running and a new message arrives for the same conversation,
  // the message is pushed to the pending queue. The runtime will inject it at
  // the next step (tool.end) boundary via steer.
  type ConversationState = {
    pendingEvents: InboundEvent[]
    activeTurnPromise: Promise<void>
  }
  const activeConversations = new Map<string, ConversationState>()

  const turnEngine: TurnEngine = {
    async submitTurn(event: InboundEvent): Promise<void> {
      const convId = event.conversationId
      const active = activeConversations.get(convId)

      if (active) {
        // Turn already running — push full event for steer at next step boundary
        active.pendingEvents.push(event)
        console.log(`[worker] queued message for steer in ${convId} (${active.pendingEvents.length} pending)`)
        return active.activeTurnPromise
      }

      // No active turn — start a new one with steer support
      const pendingEvents: InboundEvent[] = []
      const state: ConversationState = {
        pendingEvents,
        activeTurnPromise: null!,
      }

      state.activeTurnPromise = executeTurnWithSteer(event, pendingEvents)
        .finally(() => {
          if (activeConversations.get(convId) === state) {
            activeConversations.delete(convId)
          }
        })

      activeConversations.set(convId, state)
      return state.activeTurnPromise
    },
  }

  /**
   * Executes a turn with steer support. After the initial turn completes,
   * any leftover pending messages (that arrived after the last step boundary)
   * are processed as follow-up turns with their original metadata.
   */
  async function executeTurnWithSteer(initialEvent: InboundEvent, pendingEvents: InboundEvent[]): Promise<void> {
    let event = initialEvent

    // The runtime only sees text strings for steer injection; full InboundEvent
    // metadata is preserved here and used when leftover events become new turns.
    const pendingMessages = {
      drain(): string[] {
        const msgs = pendingEvents.map(e => e.text)
        pendingEvents.length = 0
        return msgs
      },
      restore(messages: string[]): void {
        // Re-create InboundEvents from text strings using the most recent event's metadata.
        // This is a fallback — ideally steer doesn't fail.
        for (const text of messages) {
          pendingEvents.unshift({ ...event, text })
        }
      },
    }

    // Loop: process initial turn, then any leftover pending messages.
    // IMPORTANT: if a turn errors, catch it and continue processing remaining
    // pending messages so they are not permanently lost.
    let lastError: unknown = null
    while (true) {
      try {
        await executeTurn(event, pendingMessages)
      } catch (err) {
        console.error(`[worker] turn error in ${event.conversationId}, will process remaining pending messages (${pendingEvents.length} left):`, err)
        lastError = err
      }

      if (pendingEvents.length === 0) break

      // Leftover messages that weren't steered — process the next as a follow-up turn
      // using the original event's full metadata (userId, userName, files, raw)
      event = pendingEvents.shift()!
      console.log(`[worker] processing leftover pending message as new turn (${pendingEvents.length} remaining)`)
    }

    // Note: we intentionally do NOT re-throw lastError here.
    // executeTurn() already handles errors internally via sendError(),
    // and re-throwing would reject the shared activeTurnPromise, causing
    // all queued callers (who called submitTurn for the same conversation)
    // to see a failure — even if their specific turn succeeded.
  }

  async function executeTurn(event: InboundEvent, pendingMessages?: import('./types.js').PendingMessageSource): Promise<void> {
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
        pendingMessages,
        disabledTools: event.disabledTools,
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

    // Start scheduler after server is listening
    scheduler?.start()

    server.listen(port, () => {
      const actualPort = (server!.address() as any)?.port ?? port
      // Notify orchestrator that we're ready, include actual port (important when port=0)
      if (process.send) {
        process.send({ type: 'ready', port: actualPort })
      }
    })
  }

  async function stop(): Promise<void> {
    scheduler?.stop()
    server?.close()
  }

  // Listen for drain signal from orchestrator
  process.on('message', (msg: any) => {
    if (msg?.type === 'drain') {
      stop()
      setTimeout(() => {
        console.error('[worker] drain timeout reached, forcing exit')
        process.exit(1)
      }, WORKER_DRAIN_TIMEOUT_MS).unref()
    }
  })

  // If the orchestrator dies (IPC disconnects), gracefully drain and exit.
  // The worker sets its own safety-net timeout so that even if the
  // orchestrator's timer disappears (e.g. full restart), this process
  // won't linger forever.
  const WORKER_DRAIN_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
  process.on('disconnect', () => {
    console.log('[worker] orchestrator disconnected, draining...')
    stop()
    setTimeout(() => {
      console.error('[worker] drain timeout reached, forcing exit')
      process.exit(1)
    }, WORKER_DRAIN_TIMEOUT_MS).unref()
  })

  return { start, stop, engine }
}
