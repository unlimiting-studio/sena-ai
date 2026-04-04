import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { ResolvedSenaConfig } from './config.js'
import type { Connector, ConnectorContext, HttpServer, InboundEvent, SessionStore, TurnEngine } from './types.js'
import { createTurnEngine } from './engine.js'
import { createScheduler } from './scheduler.js'
import { defineTool } from './tool.js'

/**
 * Module-level restart request. Can be called from anywhere in the worker process
 * (e.g. from an inline tool handler) to trigger a safe rolling restart.
 *
 * This sends an IPC message to the orchestrator, which spawns a new worker
 * and drains the current one only after all active turns complete.
 * Returns false if not running under an orchestrator (no IPC channel).
 */
export function requestWorkerRestart(): boolean {
  if (!process.send) {
    console.warn('[worker] requestWorkerRestart() called but no IPC channel (not running under orchestrator)')
    return false
  }
  console.log('[worker] requesting rolling restart from orchestrator')
  process.send({ type: 'request-restart' })
  return true
}

/**
 * Request a rolling restart and wait for the orchestrator to report the result.
 * Returns a result object with success/failure and optional error message.
 * Times out after 60s (new worker ready timeout is 30s + some margin).
 */
export function requestWorkerRestartAndWait(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!process.send) {
      resolve({ success: false, error: 'No IPC channel (not running under orchestrator)' })
      return
    }

    const TIMEOUT_MS = 60_000
    const timer = setTimeout(() => {
      process.removeListener('message', onMessage)
      resolve({ success: false, error: 'Timed out waiting for restart result from orchestrator' })
    }, TIMEOUT_MS)

    function onMessage(msg: unknown) {
      if (typeof msg === 'object' && msg !== null && (msg as Record<string, unknown>).type === 'restart-result') {
        clearTimeout(timer)
        process.removeListener('message', onMessage)
        const result = msg as { success: boolean; error?: string }
        resolve({ success: result.success, error: result.error })
      }
    }

    process.on('message', onMessage)
    console.log('[worker] requesting rolling restart from orchestrator (awaiting result)')
    process.send({ type: 'request-restart' })
  })
}

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
  const configDir = process.env.SENA_CONFIG_PATH
    ? dirname(resolve(process.env.SENA_CONFIG_PATH))
    : process.cwd()
  const connectorContext: ConnectorContext = {
    cwd: config.cwd,
    configDir,
    promptBaseDir: config.cwd,
  }
  const sessionStore = options.sessionStore
    ?? (config.cwd
      ? createFileSessionStore(resolve(config.cwd, '.sessions.json'))
      : createInMemorySessionStore())
  let server: Server | null = null

  // Built-in tools provided by the framework.
  const builtinTools = [
    defineTool({
      name: 'restart_agent',
      description: '에이전트 프로세스를 안전하게 재시작합니다. 설정 변경 후 반영이 필요할 때 사용하세요. 재시작이 실패하면 에러 내용이 반환됩니다 — 에러를 수정한 후 다시 시도하세요.',
      handler: async () => {
        const result = await requestWorkerRestartAndWait()
        if (result.success) {
          return '재시작 성공. 현재 턴이 끝나면 새 워커로 교체됩니다.'
        }
        return `재시작 실패: ${result.error}\n\n설정 파일(sena.config.ts)에 오류가 있을 수 있습니다. 에러 내용을 확인하고 수정한 후 다시 restart_agent를 호출하세요.`
      },
    }),
  ]

  const engine = createTurnEngine({
    name: config.name,
    cwd: config.cwd,
    runtime: config.runtime,
    hooks: config.hooks,
    tools: [...builtinTools, ...(config.tools ?? [])],
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
    abortController: AbortController
  }
  const activeConversations = new Map<string, ConversationState>()

  const turnEngine: TurnEngine = {
    abortConversation(conversationId: string): boolean {
      const state = activeConversations.get(conversationId)
      if (!state) return false
      console.log(`[worker] aborting conversation ${conversationId}`)
      state.abortController.abort('reaction:x')
      return true
    },

    async submitTurn(event: InboundEvent): Promise<void> {
      if (draining) {
        console.log(`[worker] rejecting new turn for ${event.conversationId} — draining`)
        return
      }

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
      const abortController = new AbortController()
      const state: ConversationState = {
        pendingEvents,
        activeTurnPromise: null!,
        abortController,
      }

      state.activeTurnPromise = executeTurnWithSteer(event, pendingEvents, abortController.signal)
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
  async function executeTurnWithSteer(initialEvent: InboundEvent, pendingEvents: InboundEvent[], abortSignal: AbortSignal): Promise<void> {
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

    // Loop: process initial turn, then any leftover pending messages and follow-ups.
    // IMPORTANT: if a turn errors, catch it and continue processing remaining
    // pending messages so they are not permanently lost.
    let lastError: unknown = null
    while (true) {
      let followUps: string[] = []
      try {
        followUps = await executeTurn(event, pendingMessages, abortSignal)
      } catch (err) {
        console.error(`[worker] turn error in ${event.conversationId}, will process remaining pending messages (${pendingEvents.length} left):`, err)
        lastError = err
      }

      // onTurnEnd hooks may request follow-up turns — enqueue them
      for (const text of followUps) {
        pendingEvents.push({ ...event, text })
        console.log(`[worker] enqueued follow-up from onTurnEnd hook`)
      }

      if (pendingEvents.length === 0) break

      // Leftover messages that weren't steered or follow-ups — process as new turn
      // using the original event's full metadata (userId, userName, files, raw)
      event = pendingEvents.shift()!
      console.log(`[worker] processing next pending message as new turn (${pendingEvents.length} remaining)`)
    }

    // Note: we intentionally do NOT re-throw lastError here.
    // executeTurn() already handles errors internally via sendError(),
    // and re-throwing would reject the shared activeTurnPromise, causing
    // all queued callers (who called submitTurn for the same conversation)
    // to see a failure — even if their specific turn succeeded.
  }

  /**
   * Executes a single turn. Returns follow-up prompts from onTurnEnd hooks (if any).
   */
  async function executeTurn(event: InboundEvent, pendingMessages?: import('./types.js').PendingMessageSource, abortSignal?: AbortSignal): Promise<string[]> {
    // Create output for the originating connector
    const connector = connectorMap.get(event.connector)
    if (!connector) {
      console.error(`[worker] connector not found: "${event.connector}" (registered: ${[...connectorMap.keys()].join(', ')})`)
      return []
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
        abortSignal,
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
        onEvent: (() => {
          if (!output) return undefined
          // Accumulate progress text so showProgress always receives the full current text.
          // `progress` events replace entirely (each assistant message);
          // `progress.delta` events append (streaming chunks within one message).
          let progressText = ''
          return (evt: import('./types.js').RuntimeEvent) => {
            if (evt.type === 'progress') {
              progressText = evt.text
              output.showProgress(progressText).catch(() => {})
            } else if (evt.type === 'progress.delta') {
              progressText += evt.text
              output.showProgress(progressText).catch(() => {})
            }
          }
        })(),
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
        // Suppress error message when turn was aborted by user
        if (abortSignal?.aborted) {
          console.log(`[worker] turn aborted, suppressing error: ${trace.error}`)
        } else {
          console.log(`[worker] sending error to ${event.connector}: ${trace.error}`)
          await output.sendError(trace.error)
        }
      } else {
        console.warn(`[worker] turn finished but no result and no error`)
      }

      return trace.followUps ?? []
    } catch (err) {
      // Suppress error message when turn was aborted by user
      if (abortSignal?.aborted) {
        console.log(`[worker] turn aborted, suppressing catch error`)
      } else {
        console.error(`[worker] submitTurn error:`, err)
        try {
          await output.sendError(err instanceof Error ? err.message : String(err))
        } catch (sendErr) {
          console.error(`[worker] sendError also failed:`, sendErr)
        }
      }
      return []
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
    connector.registerRoutes(httpServer, turnEngine, connectorContext)
  }

  async function start(): Promise<void> {
    // Start scheduler regardless of server
    scheduler?.start()

    // If no routes registered (e.g. platform connector is outbound-only),
    // skip HTTP server entirely — no port needed
    if (routes.length === 0) {
      if (process.send) {
        process.send({ type: 'ready', port: 0 })
      }
      return
    }

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

  let draining = false

  async function stop(): Promise<void> {
    scheduler?.stop()
    server?.close()
    // Stop all connectors (closes persistent connections like Socket Mode WebSocket)
    await Promise.allSettled(
      config.connectors.map(c => Promise.resolve(c.stop?.())),
    )
  }

  /**
   * Graceful drain: stop accepting new work, wait for in-flight turns to finish,
   * then exit. The safety-net timeout is only for truly stuck processes.
   */
  async function drain(): Promise<void> {
    if (draining) return
    draining = true

    // 1. Stop accepting new events (close server, connectors, scheduler)
    await stop()

    // 2. Wait for all in-flight turns to complete naturally
    if (activeConversations.size > 0) {
      console.log(`[worker] draining: waiting for ${activeConversations.size} active turn(s) to finish`)
      await Promise.allSettled(
        [...activeConversations.values()].map(s => s.activeTurnPromise),
      )
      console.log('[worker] all active turns finished, exiting')
    } else {
      console.log('[worker] no active turns, exiting immediately')
    }

    process.exit(0)
  }

  // Safety-net timeout — only for truly stuck processes (e.g. hung API call).
  // Normal drain completes via the active turn promises above.
  const DRAIN_SAFETY_TIMEOUT_MS = 300_000 // 5 minutes

  // Listen for drain signal from orchestrator
  process.on('message', (msg: any) => {
    if (msg?.type === 'drain') {
      drain()
      setTimeout(() => {
        console.error('[worker] drain safety timeout reached, forcing exit')
        process.exit(1)
      }, DRAIN_SAFETY_TIMEOUT_MS).unref()
    }
  })

  // If the orchestrator dies (IPC disconnects), gracefully drain and exit.
  process.on('disconnect', () => {
    console.log('[worker] orchestrator disconnected, draining...')
    drain()
    setTimeout(() => {
      console.error('[worker] drain safety timeout reached, forcing exit')
      process.exit(1)
    }, DRAIN_SAFETY_TIMEOUT_MS).unref()
  })

  return { start, stop, engine, requestRestart: requestWorkerRestart }
}
