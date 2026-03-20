import type {
  Connector,
  InboundEvent,
  ConnectorOutput,
  ConnectorOutputContext,
  HttpServer,
  TurnEngine,
} from '@sena-ai/core'

// ── Public types ──

export type SunnyConnectorOptions = {
  /** Optional bearer token for authenticating requests from sunny orchestrator */
  authToken?: string
  /** Default timeout in ms for task processing (default: 120_000 = 2min) */
  defaultTimeoutMs?: number
}

export type SunnyReportPayload = {
  title: string
  content: string
  summary: string
}

export type SunnyTaskResponse = {
  taskId: string
  status: 'completed' | 'failed'
  sessionId: string | null
  report: SunnyReportPayload | null
  error: string | null
}

// ── Internal: pending task resolution ──

type PendingTask = {
  resolve: (result: SunnyTaskResponse) => void
  sessionId: string | null
  taskId: string
}

// ── Report parser ──

/**
 * Parse sena's raw text response into a structured report.
 * Extracts title from first non-empty line, uses full text as content,
 * and first paragraph (or truncated content) as summary.
 */
function parseReportFromText(text: string): SunnyReportPayload {
  const lines = text.split('\n')
  const firstNonEmpty = lines.find((l) => l.trim().length > 0) ?? ''

  // Title: strip markdown heading prefix, truncate
  const title = firstNonEmpty.replace(/^#+\s*/, '').trim().slice(0, 100) || '작업 완료'

  // Summary: first non-heading, non-directive paragraph or first 200 chars
  const paragraphs = text.split(/\n\n+/)
  const firstParagraph = paragraphs.find(
    (p) => p.trim().length > 0 && !p.trim().startsWith(':::') && !p.trim().startsWith('#'),
  )
  const summary =
    firstParagraph?.trim().slice(0, 200) ?? text.replace(/^#+\s*.+\n*/, '').trim().slice(0, 200)

  return {
    title,
    content: text,
    summary: summary || '작업이 완료되었어요.',
  }
}

// ── Connector factory ──

export function sunnyConnector(options: SunnyConnectorOptions = {}): Connector {
  const { authToken, defaultTimeoutMs = 120_000 } = options

  // Per-instance pending tasks map
  const pendingTasks = new Map<string, PendingTask>()

  return {
    name: 'sunny',

    registerRoutes(server: HttpServer, engine: TurnEngine): void {
      server.post('/api/sunny/tasks', (req: any, res: any) => {
        handleTaskRequest(req, res, engine, authToken, defaultTimeoutMs, pendingTasks)
      })
    },

    createOutput(context: ConnectorOutputContext): ConnectorOutput {
      // conversationId is the key used in pendingTasks (= conversationId from submitTurn)
      const convId = context.conversationId

      return {
        async showProgress(_text: string): Promise<void> {
          // Sunny doesn't need progress through output —
          // orchestrator receives progress via WebSocket
        },

        async sendResult(text: string): Promise<void> {
          const pending = pendingTasks.get(convId)
          if (!pending) return

          const report = parseReportFromText(text)
          pending.resolve({
            taskId: pending.taskId,
            status: 'completed',
            sessionId: pending.sessionId,
            report,
            error: null,
          })
          pendingTasks.delete(convId)
        },

        async sendError(message: string): Promise<void> {
          const pending = pendingTasks.get(convId)
          if (!pending) return

          pending.resolve({
            taskId: pending.taskId,
            status: 'failed',
            sessionId: pending.sessionId,
            report: null,
            error: message,
          })
          pendingTasks.delete(convId)
        },

        async dispose(): Promise<void> {
          // Cleanup: if still pending (e.g. engine error not caught), resolve as failed
          const pending = pendingTasks.get(convId)
          if (pending) {
            pending.resolve({
              taskId: pending.taskId,
              status: 'failed',
              sessionId: null,
              report: null,
              error: '작업이 비정상 종료되었어요.',
            })
            pendingTasks.delete(convId)
          }
        },
      }
    },
  }
}

// ── Request handler ──

async function handleTaskRequest(
  req: any,
  res: any,
  engine: TurnEngine,
  authToken: string | undefined,
  defaultTimeoutMs: number,
  pendingTasks: Map<string, PendingTask>,
): Promise<void> {
  // Auth check
  if (authToken) {
    const header = req.headers?.authorization ?? ''
    if (header !== `Bearer ${authToken}`) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
  }

  const body = req.body
  const taskId = body?.taskId as string | undefined
  const goal = body?.goal as string | undefined

  if (!taskId || !goal) {
    res.status(400).json({ error: 'taskId and goal are required' })
    return
  }

  const context = (body?.context ?? {}) as Record<string, unknown>
  const timeoutMs = (body?.latencyBudgetMs as number) ?? defaultTimeoutMs

  // For session continuity: use provided sessionId as conversationId,
  // so sena's session store can resume the conversation.
  // For new tasks, use taskId as conversationId.
  const conversationId = (context.sessionId as string) ?? taskId

  // Create a promise that the output will resolve.
  // Key by conversationId because createOutput receives conversationId (not taskId).
  const resultPromise = new Promise<SunnyTaskResponse>((resolve) => {
    pendingTasks.set(conversationId, { resolve, sessionId: conversationId, taskId })
  })

  // Timeout guard
  const timer = setTimeout(() => {
    const pending = pendingTasks.get(conversationId)
    if (pending) {
      pending.resolve({
        taskId,
        status: 'failed',
        sessionId: conversationId,
        report: null,
        error: '작업 시간이 초과되었어요.',
      })
      pendingTasks.delete(conversationId)
    }
  }, timeoutMs)

  // Build goal text with context enrichment
  const goalWithContext = buildGoalText(goal, context)

  // Submit turn to sena engine
  const inbound: InboundEvent = {
    connector: 'sunny',
    conversationId,
    userId: (context.userId as string) ?? 'sunny-user',
    userName: (context.userName as string) ?? 'Sunny',
    text: goalWithContext,
    raw: body,
  }

  // Fire and forget — result comes via createOutput's sendResult/sendError
  engine.submitTurn(inbound).catch((err: unknown) => {
    const pending = pendingTasks.get(conversationId)
    if (pending) {
      pending.resolve({
        taskId,
        status: 'failed',
        sessionId: conversationId,
        report: null,
        error: err instanceof Error ? err.message : 'engine error',
      })
      pendingTasks.delete(conversationId)
    }
  })

  try {
    const result = await resultPromise
    clearTimeout(timer)

    // Ensure sessionId reflects the conversationId (for follow-up linkage)
    result.sessionId = conversationId
    res.status(200).json(result)
  } catch (err: unknown) {
    clearTimeout(timer)
    pendingTasks.delete(conversationId)
    res.status(500).json({
      taskId,
      status: 'failed',
      sessionId: null,
      report: null,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }
}

// ── Goal text builder ──

function buildGoalText(goal: string, context: Record<string, unknown>): string {
  const parts: string[] = []

  // Add report context if this is a follow-up
  if (context.reportId) {
    parts.push(`[이전 보고서 ID: ${context.reportId}]`)
  }

  // Add recent turns for conversation context
  const recentTurns = context.recentTurns as string[] | undefined
  if (recentTurns?.length) {
    parts.push(`[최근 대화]\n${recentTurns.join('\n')}`)
  }

  parts.push(goal)

  return parts.join('\n\n')
}
