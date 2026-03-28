import { isBrandedToolResult } from '@sena-ai/core'
import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment, ToolPort, McpToolPort, McpConfig, RuntimeInfo, InlineToolPort } from '@sena-ai/core'
import { SdkMessageMapper } from './mapper.js'

type NativeTool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  handler: (params: any) => Promise<any>
}

export function buildToolConfig(tools: ToolPort[], runtimeInfo: RuntimeInfo) {
  const mcpServers: Record<string, McpConfig> = {}
  const nativeTools: NativeTool[] = []
  const allowedTools: string[] = []

  for (const tool of tools) {
    if (tool.type === 'inline') {
      nativeTools.push({
        name: tool.name,
        description: tool.inline.description,
        input_schema: tool.inline.inputSchema,
        handler: wrapHandler(tool.inline.handler),
      })
      allowedTools.push(tool.name)
    } else {
      mcpServers[tool.name] = tool.toMcpConfig(runtimeInfo)
      allowedTools.push(`mcp__${tool.name}__*`)
    }
  }

  return { mcpServers, nativeTools, allowedTools }
}

export function formatDebugOptionsForLog(sdkOptions: Record<string, any>, systemPrompt: string): string {
  const debugOpts: Record<string, any> = { ...sdkOptions, systemPrompt: `${systemPrompt.length}ch` }
  if (debugOpts.mcpServers) {
    debugOpts.mcpServers = Object.fromEntries(
      Object.entries(debugOpts.mcpServers as Record<string, any>).map(([name, server]) => [
        name,
        summarizeMcpServerForLog(server),
      ]),
    )
  }
  return safeJsonStringify(debugOpts, 2)
}

function summarizeMcpServerForLog(server: any): Record<string, any> | string {
  if (!server || typeof server !== 'object') return server

  const summary: Record<string, any> = {}
  if ('type' in server) summary.type = server.type
  if ('command' in server) summary.command = server.command
  if ('args' in server) summary.args = server.args
  if ('url' in server) summary.url = server.url
  if ('transport' in server) summary.transport = server.transport
  if ('env' in server) summary.env = maskEnvForLog(server.env)

  return Object.keys(summary).length > 0 ? summary : { type: 'sdk-mcp-server' }
}

function maskEnvForLog(env: unknown): Record<string, string> | undefined {
  if (!env || typeof env !== 'object') return undefined
  return Object.fromEntries(
    Object.entries(env as Record<string, any>).map(([key, value]) => [
      key,
      value ? `${String(value).slice(0, 8)}...` : '(empty)',
    ]),
  )
}

function safeJsonStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'object' && currentValue !== null) {
      if (seen.has(currentValue)) {
        return '[Circular]'
      }
      seen.add(currentValue)
    }
    return currentValue
  }, space)
}

function wrapHandler(handler: (params: any) => any) {
  return async (params: any) => {
    try {
      const raw = await handler(params)
      if (isBrandedToolResult(raw)) {
        return {
          content: raw.content.map((c: any) => {
            if (c.type === 'text') return { type: 'text', text: c.text }
            if (c.type === 'image') return {
              type: 'image',
              data: c.data,
              mimeType: c.mimeType,
            }
            throw new Error(`Unknown ToolContent type: ${c.type}`)
          }),
        }
      }
      if (typeof raw === 'string') return { content: [{ type: 'text', text: raw }] }
      return { content: [{ type: 'text', text: JSON.stringify(raw) }] }
    } catch (err: any) {
      return { isError: true, content: [{ type: 'text', text: err.message }] }
    }
  }
}

/**
 * Default set of allowed tools for `dontAsk` mode.
 * Covers all built-in Claude Code tools that are safe for typical agent workflows.
 * MCP tools registered via `tools` config are auto-allowed separately.
 */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  // File operations
  'Read', 'Write', 'Edit', 'MultiEdit',
  // Search & navigation
  'Glob', 'Grep', 'LS',
  // Execution
  'Bash',
  // Notebooks
  'NotebookRead', 'NotebookEdit',
  // Agent & planning
  'Agent', 'ToolSearch',
]

export type ClaudeRuntimeOptions = {
  model?: string
  apiKey?: string
  maxTurns?: number
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
  /**
   * Tool name patterns to auto-allow without permission prompts (e.g. 'Read', 'Bash', 'mcp__*').
   * Only meaningful when permissionMode is NOT 'bypassPermissions'.
   * Defaults to `DEFAULT_ALLOWED_TOOLS` when not specified and permissionMode is 'dontAsk'.
   * Pass an empty array `[]` to start with no pre-approved tools.
   */
  allowedTools?: string[]
  /** Tool name patterns to always disallow (e.g. 'mcp__some_server__*'). Merged with per-turn disabledTools. */
  disallowedTools?: string[]
}

export function claudeRuntime(options: ClaudeRuntimeOptions = {}): Runtime {
  const {
    model = 'claude-sonnet-4-5',
    apiKey,
    maxTurns,
    permissionMode = 'dontAsk',
    allowedTools: configAllowedTools = permissionMode === 'dontAsk' ? [...DEFAULT_ALLOWED_TOOLS] : undefined,
    disallowedTools: staticDisallowedTools = [],
  } = options

  return {
    name: 'claude',

    async *createStream(streamOptions: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent> {
      const { query } = await import('@anthropic-ai/claude-agent-sdk')

      const {
        contextFragments,
        prompt: promptIterable,
        tools,
        sessionId,
        cwd,
        env: envVars,
        abortSignal,
        pendingMessages,
        disabledTools,
      } = streamOptions

      // Build system prompt from system fragments only
      const systemPrompt = buildSystemPrompt(contextFragments)

      // Build prepend/append wrappers for user message
      const { prepend, append } = buildMessageWrappers(contextFragments)

      // Build tool config splitting inline and MCP tools
      const runtimeInfo: RuntimeInfo = { name: 'claude' }
      const { mcpServers, nativeTools, allowedTools } = buildToolConfig(tools, runtimeInfo)

      // Get first user message from prompt iterable, wrapped with prepend/append fragments
      let userText = ''
      for await (const msg of promptIterable) {
        userText = wrapUserMessage(msg.text, prepend, append)
        break
      }

      // Build SDK options
      const sdkOptions: Record<string, any> = {
        model: streamOptions.model || model,
        ...(maxTurns != null && { maxTurns }),
        cwd: cwd || process.cwd(),
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        systemPrompt,
        settingSources: ['user', 'project'],
        // Block first-party integrations (Claude AI Slack, etc.) to prevent
        // the agent from accidentally acting under the human user's identity.
        // Also merge any per-turn disabledTools from the connector.
        disallowedTools: [
          'mcp__claude_ai_Slack__*',
          ...staticDisallowedTools,
          ...(disabledTools ?? []),
        ],
      }

      // Create abort controller from signal
      const controller = new AbortController()
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason)
      } else {
        abortSignal.addEventListener('abort', () => controller.abort(abortSignal.reason), { once: true })
      }
      sdkOptions.abortController = controller

      // Build env: only set if we have overrides (apiKey or envVars).
      // MCP tools are always deferred in the SDK — ToolSearch must remain enabled (default)
      // to let the model fetch MCP tool schemas on demand.
      if (apiKey || Object.keys(envVars).length > 0) {
        const sdkEnv: Record<string, string | undefined> = { ...envVars }
        if (apiKey) {
          sdkEnv.ANTHROPIC_API_KEY = apiKey
        }
        sdkOptions.env = sdkEnv
      }

      // Register inline (native) tools as an in-process SDK MCP server so the
      // Claude Agent SDK can invoke them via the MCP protocol.
      const allMcpServers = { ...mcpServers }
      // Strip bare inline tool names from allowedTools — they will be re-added
      // below under the mcp__<server>__* wildcard after the server is registered.
      const inlineToolNames = new Set(nativeTools.map(t => t.name))
      const effectiveAllowedTools = allowedTools.filter(t => !inlineToolNames.has(t))

      if (nativeTools.length > 0) {
        const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')
        const { z } = await import('zod')

        const NATIVE_SERVER_NAME = '__native__'

        const inlineTools = tools.filter((t): t is InlineToolPort => t.type === 'inline')
        const sdkTools = inlineTools.map(t => ({
          name: t.name,
          description: t.inline.description,
          // Use the original Zod params shape when available so the model sees
          // typed parameter descriptions.  Fall back to passthrough for tools
          // that were registered without explicit params.
          inputSchema: t.inline.params ?? (z.object({}).passthrough() as any),
          handler: wrapHandler(t.inline.handler),
        }))

        const sdkServer = createSdkMcpServer({ name: NATIVE_SERVER_NAME, tools: sdkTools as any })
        allMcpServers[NATIVE_SERVER_NAME] = sdkServer as any
        // Auto-allow all tools on the native SDK server
        effectiveAllowedTools.push(`mcp__${NATIVE_SERVER_NAME}__*`)
      }

      if (Object.keys(allMcpServers).length > 0) {
        sdkOptions.mcpServers = allMcpServers
      }
      // Pass allowedTools to the SDK so it knows which tools to auto-approve.
      // When bypassPermissions is active this is redundant but harmless.
      // Merge tool-config patterns (MCP wildcards, native server wildcard)
      // with any user-supplied patterns from the runtime config.
      if (configAllowedTools) {
        effectiveAllowedTools.push(...configAllowedTools)
      }
      if (effectiveAllowedTools.length > 0) {
        sdkOptions.allowedTools = effectiveAllowedTools
      }

      if (sessionId) {
        sdkOptions.resume = sessionId
      }

      // Debug: log SDK options without traversing circular SDK-native MCP server objects.
      console.log(`[runtime-claude] query options:`, formatDebugOptionsForLog(sdkOptions, systemPrompt))

      // Steer loop: run query, and if pending messages arrive at a tool boundary,
      // interrupt + resume with the new message.
      let currentPrompt = userText
      let currentSessionId = sessionId
      let shouldContinue = true
      const mapper = new SdkMessageMapper()

      while (shouldContinue) {
        shouldContinue = false

        const currentOptions = { ...sdkOptions }
        if (currentSessionId) {
          currentOptions.resume = currentSessionId
        }

        // Create a per-iteration abort controller that we can interrupt for steer
        const iterController = new AbortController()
        if (abortSignal.aborted) {
          iterController.abort(abortSignal.reason)
        } else {
          abortSignal.addEventListener('abort', () => iterController.abort(abortSignal.reason), { once: true })
        }
        currentOptions.abortController = iterController

        const stream = query({ prompt: currentPrompt, options: currentOptions })
        let steerInterrupted = false

        for await (const msg of stream) {
          const events = mapper.map(msg)
          for (const event of events) {
            // Track session ID for resume
            if (event.type === 'session.init') {
              currentSessionId = event.sessionId
            }

            // Suppress error/result events from an interrupted stream
            if (steerInterrupted && (event.type === 'error' || event.type === 'result')) {
              continue
            }

            yield event
          }

          // Detect tool completion from SDK messages.
          // `user` messages with tool_result content indicate a tool call finished.
          const isToolComplete = msg.type === 'user' && Array.isArray((msg as any).content)
            && (msg as any).content.some((b: any) => b.type === 'tool_result')

          if (isToolComplete && pendingMessages && !steerInterrupted) {
            const pending = pendingMessages.drain()
            if (pending.length > 0) {
              console.log(`[runtime-claude] interrupting for steer with ${pending.length} pending message(s)`)
              currentPrompt = pending.join('\n')
              shouldContinue = true
              steerInterrupted = true
              try {
                await stream.interrupt()
              } catch {
                // interrupt() may throw if stream already ended
              }
              // Continue consuming remaining events from this stream before restart
            }
          }
        }
      }
    },
  }
}

function buildSystemPrompt(fragments: ContextFragment[]): string {
  const systemFragments = fragments.filter(f => f.role === 'system')

  const parts: string[] = []
  for (const f of systemFragments) {
    parts.push(`[${f.source}]\n${f.content}`)
  }

  return parts.join('\n\n')
}

function buildMessageWrappers(fragments: ContextFragment[]): { prepend: string; append: string } {
  const prependParts: string[] = []
  const appendParts: string[] = []

  for (const f of fragments.filter(f => f.role === 'prepend')) {
    prependParts.push(`[${f.source}]\n${f.content}`)
  }
  for (const f of fragments.filter(f => f.role === 'append')) {
    appendParts.push(`[${f.source}]\n${f.content}`)
  }

  return {
    prepend: prependParts.join('\n\n'),
    append: appendParts.join('\n\n'),
  }
}

function wrapUserMessage(text: string, prepend: string, append: string): string {
  const parts: string[] = []
  if (prepend) parts.push(prepend)
  parts.push(text)
  if (append) parts.push(append)
  return parts.join('\n\n')
}
