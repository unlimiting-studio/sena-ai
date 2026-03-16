import { isBrandedToolResult } from '@sena-ai/core'
import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment, ToolPort, McpToolPort, McpConfig, RuntimeInfo } from '@sena-ai/core'
import { mapSdkMessage } from './mapper.js'

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
              source: { type: 'base64', media_type: c.mimeType, data: c.data },
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

      // Build tool config splitting inline and MCP tools
      const runtimeInfo: RuntimeInfo = { name: 'claude' }
      const { mcpServers, nativeTools, allowedTools } = buildToolConfig(tools, runtimeInfo)

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
      }
      if (allowedTools.length > 0) {
        sdkOptions.allowedTools = allowedTools
      }
      // nativeTools reserved for future SDK native tool support
      void nativeTools

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

