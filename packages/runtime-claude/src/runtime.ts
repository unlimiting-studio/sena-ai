import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment, ToolPort, RuntimeInfo } from '@sena-ai/core'
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

      if (apiKey) {
        sdkOptions.env = { ...envVars, ANTHROPIC_API_KEY: apiKey }
      } else if (Object.keys(envVars).length > 0) {
        sdkOptions.env = envVars
      }

      if (Object.keys(mcpServers).length > 0) {
        sdkOptions.mcpServers = mcpServers
        sdkOptions.allowedTools = allowedTools
      }

      if (sessionId) {
        sdkOptions.resume = sessionId
      }

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
  const servers: Record<string, any> = {}
  for (const tool of tools) {
    servers[tool.name] = tool.toMcpConfig(runtimeInfo)
  }
  return servers
}
