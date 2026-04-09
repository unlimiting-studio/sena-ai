// === ContextFragment (Part 3) ===

export type ContextFragment = {
  source: string
  role: 'system' | 'prepend' | 'append'
  content: string
}

// === TurnContext (Part 3) ===

export type FileAttachment = {
  id: string
  name: string
  mimeType: string
  url?: string
  /** Local file path after download. When present, the file can be read directly without further API calls. */
  localPath?: string
}

export type TurnContext = {
  turnId: string
  agentName: string
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string

  connector?: {
    name: string
    conversationId: string
    userId: string
    userName: string
    files?: FileAttachment[]
    raw: unknown
  }

  schedule?: {
    name: string
    type: 'cron' | 'heartbeat'
  }

  sessionId: string | null
  metadata: Record<string, unknown>
}

// === TurnResult (Part 3) ===

export type TurnResult = {
  text: string
  sessionId: string | null
  durationMs: number
  toolCalls: { toolName: string; durationMs: number; isError: boolean }[]
}

// === TurnTrace (Part 3) ===

export type HookTrace = {
  phase: 'onTurnStart' | 'onTurnEnd' | 'onError'
  name: string
  durationMs: number
  fragments: ContextFragment[]
}

export type TurnFollowUp = {
  prompt: string
  fork: boolean
  detached: boolean
}

export type TurnTrace = {
  turnId: string
  timestamp: string
  agentName: string
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string
  hooks: HookTrace[]
  assembledContext: string
  result: TurnResult | null
  error: string | null
  /** Follow-up prompts from onTurnEnd hooks. Worker will process these as continuation turns. */
  followUps?: TurnFollowUp[]
}

// === Runtime (Part 5) ===

export type UserMessage = {
  text: string
  files?: FileAttachment[]
}

export type RuntimeEvent =
  | { type: 'session.init'; sessionId: string }
  | { type: 'progress'; text: string }
  | { type: 'progress.delta'; text: string }
  | { type: 'tool.start'; toolName: string }
  | { type: 'tool.end'; toolName: string; isError: boolean; toolInput?: unknown; toolResponse?: unknown }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }

export type RuntimeInfo = {
  name: string
}

/**
 * A channel for injecting pending messages into an active turn.
 * The worker pushes messages here; the runtime drains them at step boundaries.
 */
export type PendingMessageSource = {
  /** Returns and removes all pending messages. Empty array if none. */
  drain(): string[]
  /** Puts messages back into the queue (e.g. when steer fails). */
  restore(messages: string[]): void
}

export type RuntimeStreamOptions = {
  model: string
  contextFragments: ContextFragment[]
  prompt: AsyncIterable<UserMessage>
  tools: ToolPort[]
  sessionId: string | null
  cwd: string
  env: Record<string, string>
  abortSignal: AbortSignal
  /** Pending messages to inject via steer at step (tool.end) boundaries. */
  pendingMessages?: PendingMessageSource
  /** Tool names/patterns to disable for this turn (blocklist). Runtimes apply this in their own way. */
  disabledTools?: string[]
  hooks?: import('./runtime-hooks.js').RuntimeHooks
}

export type Runtime = {
  name: string
  createStream(options: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent>
}

// === Connector (Part 4) ===

export type InboundEvent = {
  connector: string
  conversationId: string
  userId: string
  userName: string
  text: string
  /** Original user-facing message text before connector-level prompts are prepended/appended. */
  userText?: string
  files?: FileAttachment[]
  raw: unknown
  /** Tool names/patterns to disable for this turn (blocklist). */
  disabledTools?: string[]
}

export type ConnectorOutputContext = {
  conversationId: string
  connector: string
  metadata?: unknown
}

export type ConnectorContext = {
  cwd: string
  configDir: string
  promptBaseDir: string
}

export type ConnectorOutput = {
  showProgress(text: string): Promise<void>
  sendResult(text: string): Promise<void>
  sendError(message: string): Promise<void>
  dispose(): Promise<void>
}

export type HttpServer = {
  post(path: string, handler: (req: unknown, res: unknown) => void): void
}

export type TurnEngine = {
  submitTurn(event: InboundEvent): Promise<void>
  /** Abort an in-flight turn for the given conversationId. Returns true if a turn was aborted. */
  abortConversation(conversationId: string): boolean
}

export type Connector = {
  name: string
  registerRoutes(server: HttpServer, engine: TurnEngine, context?: ConnectorContext): void
  createOutput(context: ConnectorOutputContext): ConnectorOutput
  /** Optional cleanup — called during worker drain to close persistent connections (e.g. WebSocket). */
  stop?(): Promise<void> | void
}

// === ToolPort (Part 6) ===

export type McpConfig = Record<string, unknown>

export type McpToolPort = {
  name: string
  type: 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type { BrandedToolResult } from './tool.js'
import type { BrandedToolResult } from './tool.js'

export type InlineToolDef = {
  description: string
  params?: Record<string, import('zod').ZodSchema>
  inputSchema: Record<string, unknown>
  handler: (params: any) => string | object | BrandedToolResult | Promise<string | object | BrandedToolResult>
}

export type InlineToolPort = {
  name: string
  type: 'inline'
  inline: InlineToolDef
}

export type ToolPort = McpToolPort | InlineToolPort

// === Schedule (Part 7) ===

export type SchedulePromptSource = string | { file: string }

export type Schedule = {
  name: string
  type: 'cron' | 'heartbeat'
  expression: string
  prompt: SchedulePromptSource
  timezone?: string
  /** Tool names/patterns to disable for turns triggered by this schedule (blocklist). */
  disabledTools?: string[]
}

// === SessionStore (Part 8) ===

export type SessionStore = {
  get(conversationId: string): Promise<string | null>
  set(conversationId: string, sessionId: string): Promise<void>
  delete(conversationId: string): Promise<void>
}

// === Config (Part 2) ===

export type OrchestratorConfig = {
  port?: number
}

export type SenaConfig = {
  name: string
  cwd?: string
  runtime: Runtime
  connectors?: Connector[]
  tools?: ToolPort[]
  hooks?: import('./runtime-hooks.js').RuntimeHooks
  schedules?: Schedule[]
  orchestrator?: OrchestratorConfig
}
