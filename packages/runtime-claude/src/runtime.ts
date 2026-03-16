import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment, ToolPort, McpToolPort, RuntimeInfo } from '@sena-ai/core'
import { mapSdkMessage } from './mapper.js'

export type ClaudeRuntimeOptions = {
  model?: string
  apiKey?: string
  maxTurns?: number
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions'
}

export function claudeRuntime(options: ClaudeRuntimeOptions = {}): Runtime {
  const {
    model = 'claude-sonnet-4-5',
    apiKey,
    maxTurns = 100,
    permissionMode = 'bypassPermissions',
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
      } = streamOptions

      // Build system prompt from context fragments
      const systemPrompt = buildSystemPrompt(contextFragments)

      // Build MCP server config from tool ports
      const runtimeInfo: RuntimeInfo = { name: 'claude' }
      const mcpServers = buildMcpServers(tools, runtimeInfo)

      // Collect allowed tool patterns
      const allowedTools = tools.map(t => `mcp__${t.name}__*`)

      // Get first user message from prompt iterable
      let userText = ''
      for await (const msg of promptIterable) {
        userText = msg.text
        break
      }

      // Build SDK options
      const sdkOptions: Record<string, any> = {
        model: streamOptions.model || model,
        maxTurns,
        cwd: cwd || process.cwd(),
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        systemPrompt,
        settingSources: [],
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

      if (Object.keys(mcpServers).length > 0) {
        sdkOptions.mcpServers = mcpServers
        sdkOptions.allowedTools = allowedTools
      }

      if (sessionId) {
        sdkOptions.resume = sessionId
      }

      // Debug: log SDK options (mask env values)
      const debugOpts: Record<string, any> = { ...sdkOptions, systemPrompt: `${systemPrompt.length}ch` }
      if (debugOpts.mcpServers) {
        debugOpts.mcpServers = Object.fromEntries(
          Object.entries(debugOpts.mcpServers as Record<string, any>).map(([k, v]: [string, any]) => [
            k,
            { ...v, env: v.env ? Object.fromEntries(Object.entries(v.env as Record<string, any>).map(([ek, ev]: [string, any]) => [ek, ev ? `${String(ev).slice(0, 8)}...` : '(empty)'])) : undefined },
          ]),
        )
      }
      console.log(`[runtime-claude] query options:`, JSON.stringify(debugOpts, null, 2))

      const stream = query({ prompt: userText, options: sdkOptions })

      for await (const msg of stream) {
        const events = mapSdkMessage(msg)
        for (const event of events) {
          yield event
        }
      }
    },
  }
}

function buildSystemPrompt(fragments: ContextFragment[]): string {
  const systemFragments = fragments.filter(f => f.role === 'system')
  const contextFragments = fragments.filter(f => f.role === 'context')

  const parts: string[] = []
  for (const f of systemFragments) {
    parts.push(`[${f.source}]\n${f.content}`)
  }
  for (const f of contextFragments) {
    parts.push(`[${f.source}]\n${f.content}`)
  }

  return parts.join('\n\n')
}

function buildMcpServers(tools: ToolPort[], runtimeInfo: RuntimeInfo): Record<string, any> {
  const mcpTools = tools.filter((t): t is McpToolPort => t.type !== 'inline')
  const servers: Record<string, any> = {}
  for (const tool of mcpTools) {
    servers[tool.name] = tool.toMcpConfig(runtimeInfo)
  }
  return servers
}
