// === ContextFragment (Part 3) ===

export type ContextFragment = {
  source: string
  role: 'system' | 'context'
  content: string
}

// === Hook interfaces (Part 3) ===

export type TurnStartHook = {
  name: string
  execute(context: TurnContext): Promise<ContextFragment[]>
}

export type TurnEndHook = {
  name: string
  execute(context: TurnContext, result: TurnResult): Promise<void>
}

export type ErrorHook = {
  name: string
  execute(context: TurnContext, error: Error): Promise<void>
}

// === TurnContext (Part 3) ===

export type FileAttachment = {
  id: string
  name: string
  mimeType: string
  url?: string
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
  | { type: 'tool.end'; toolName: string; isError: boolean }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }

export type RuntimeInfo = {
  name: string
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
  files?: FileAttachment[]
  raw: unknown
}

export type ConnectorOutputContext = {
  conversationId: string
  connector: string
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
}

export type Connector = {
  name: string
  registerRoutes(server: HttpServer, engine: TurnEngine): void
  createOutput(context: ConnectorOutputContext): ConnectorOutput
}

// === ToolPort (Part 6) ===

export type McpConfig = Record<string, unknown>

export type ToolPort = {
  name: string
  type: 'builtin' | 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}

// === Schedule (Part 7) ===

export type Schedule = {
  name: string
  type: 'cron' | 'heartbeat'
  expression: string
  prompt: string
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
  runtime: Runtime
  connectors?: Connector[]
  tools?: ToolPort[]
  hooks?: {
    onTurnStart?: TurnStartHook[]
    onTurnEnd?: TurnEndHook[]
    onError?: ErrorHook[]
  }
  schedules?: Schedule[]
  orchestrator?: OrchestratorConfig
}
