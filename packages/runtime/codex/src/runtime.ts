import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment, McpToolPort, InlineToolPort } from '@sena-ai/core'
import { CodexAppServerClient } from './client.js'
import { mapCodexNotification } from './mapper.js'
import { startInlineMcpHttpServer } from './inline-mcp-server.js'
import { evaluatePreToolUse, evaluatePostToolUse } from './hook-adapter.js'

export type CodexRuntimeOptions = {
  model?: string
  apiKey?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'always'
  /** Explicit override for the Codex executable path or command. */
  codexBin?: string
  /** Tool name patterns to always disallow. Merged with per-turn disabledTools. */
  disallowedTools?: string[]
}

export function buildCodexConfigOverrides(
  inlineBridgeUrl: string | null,
  mcpTools: McpToolPort[],
): string[] {
  const overrides: string[] = []
  if (inlineBridgeUrl) {
    overrides.push(`mcp_servers.__inline__.url="${inlineBridgeUrl}"`)
  }
  for (const tool of mcpTools) {
    const config = tool.toMcpConfig({ name: 'codex' }) as Record<string, unknown>
    if (config['url']) {
      overrides.push(`mcp_servers.${tool.name}.url="${config['url']}"`)
    } else if (config['command']) {
      const command = Array.isArray(config['command'])
        ? String(config['command'][0] ?? '')
        : String(config['command'])
      const args = Array.isArray(config['command'])
        ? config['command'].slice(1).map(String)
        : ((config['args'] as string[] | undefined) ?? [])

      if (command !== '') {
        overrides.push(`mcp_servers.${tool.name}.command="${command}"`)
      }
      if (args.length > 0) {
        overrides.push(`mcp_servers.${tool.name}.args=${JSON.stringify(args)}`)
      }
    }
  }
  return overrides
}

export function applyCodexResultTextFallback(event: RuntimeEvent, assistantText: string): RuntimeEvent {
  if (event.type === 'result' && event.text === '' && assistantText !== '') {
    return { ...event, text: assistantText }
  }
  return event
}

export function codexRuntime(options: CodexRuntimeOptions = {}): Runtime {
  const {
    model,
    apiKey,
    reasoningEffort = 'medium',
    sandboxMode = 'danger-full-access',
    approvalPolicy = 'never',
    codexBin,
    disallowedTools: staticDisallowedTools = [],
  } = options

  return {
    name: 'codex',

    async *createStream(streamOptions: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent> {
      const {
        contextFragments,
        prompt: promptIterable,
        sessionId,
        cwd,
        abortSignal,
        tools = [],
        pendingMessages,
        hooks,
        disabledTools,
      } = streamOptions

      // Merge static disallowedTools with per-turn disabledTools.
      // Codex CLI does not currently support a disabledTools config override,
      // so we filter the tools array at the runtime layer for any remaining matches
      // (engine already filters exact-match ToolPort names, but static disallowedTools
      // and pattern matches need to be handled here).
      const mergedDisallowedTools = [...staticDisallowedTools, ...(disabledTools ?? [])]
      if (mergedDisallowedTools.length > 0) {
        console.log(`[runtime-codex] disabledTools (merged): ${JSON.stringify(mergedDisallowedTools)}`)
      }

      if (apiKey) {
        process.env.OPENAI_API_KEY = apiKey
      }

      // Filter tools by mergedDisallowedTools (exact name match).
      // Engine already did exact-match filtering for per-turn disabledTools on ToolPort names,
      // but static disallowedTools from runtime config need runtime-level filtering.
      const filteredTools = mergedDisallowedTools.length > 0
        ? tools.filter((t) => !mergedDisallowedTools.includes(t.name))
        : tools

      const inlineTools = filteredTools.filter((t): t is InlineToolPort => t.type === 'inline')
      const mcpTools = filteredTools.filter((t): t is McpToolPort => t.type === 'mcp-http' || t.type === 'mcp-stdio')

      const bridge = await startInlineMcpHttpServer(inlineTools)
      const configOverrides = buildCodexConfigOverrides(bridge?.url ?? null, mcpTools)

      const client = new CodexAppServerClient(codexBin)

      const eventQueue: RuntimeEvent[] = []
      let resolveWait: (() => void) | null = null
      let turnDone = false
      let expectedTurnId: string | null = null
      let latestAssistantText = ''

      function pushEvent(event: RuntimeEvent) {
        eventQueue.push(event)
        resolveWait?.()
      }

      client.on('notification', (msg: { method: string; params: unknown }) => {
        const params = msg.params as Record<string, unknown> | undefined

        if (msg.method === 'turn/completed') {
          const turnId = (params?.turn as Record<string, unknown> | undefined)?.id as string | undefined
          if (expectedTurnId && turnId && turnId !== expectedTurnId) {
            // This turn/completed is for a steered (interrupted) turn — skip it
            console.log(`[runtime-codex] ignoring turn/completed for steered turn ${turnId?.slice(0, 8)}`)
            return
          }
          turnDone = true
          resolveWait?.()
        }

        if (msg.method === 'error') {
          turnDone = true
          resolveWait?.()
        }

        let event = mapCodexNotification(msg.method, params)
        if (event) {
          if (event.type === 'progress') {
            latestAssistantText = event.text
          } else if (event.type === 'progress.delta') {
            latestAssistantText += event.text
          } else if (event.type === 'result') {
            event = applyCodexResultTextFallback(event, latestAssistantText)
          }

          // Fire-and-forget postToolUse hooks for tool.end events
          if (event.type === 'tool.end' && hooks) {
            evaluatePostToolUse(
              hooks,
              event.toolName,
              (event.toolInput as Record<string, unknown>) ?? {},
              typeof event.toolResponse === 'string' ? event.toolResponse : JSON.stringify(event.toolResponse ?? ''),
              event.isError,
              expectedTurnId ?? 'unknown',
              sessionId ?? 'unknown',
              cwd || process.cwd(),
            ).catch((err) => {
              console.error('[sena][codex] PostToolUse hook error (fire-and-forget):', err)
            })
          }
          pushEvent(event)
        }
      })

      // Server requests requiring client response (approval, input, etc.)
      client.on('server-request', (msg: { id: number; method: string; params: unknown }) => {
        const handleApproval = async () => {
          const params = msg.params as Record<string, unknown> | undefined

          switch (msg.method) {
            // Official approval request methods per ServerRequest.ts
            case 'item/commandExecution/requestApproval':
            case 'item/fileChange/requestApproval':
            case 'item/permissions/requestApproval':
            case 'applyPatchApproval':
            case 'execCommandApproval': {
              // Evaluate preToolUse hooks before applying approval policy
              if (hooks) {
                const toolName = extractToolNameFromApproval(msg.method, params)
                const toolInput = extractToolInputFromApproval(msg.method, params)
                try {
                  const hookDecision = await evaluatePreToolUse(
                    hooks,
                    toolName,
                    toolInput,
                    expectedTurnId ?? 'unknown',
                    sessionId ?? 'unknown',
                    cwd || process.cwd(),
                  )
                  if (hookDecision.decision === 'deny') {
                    client.respond(msg.id, { decision: 'decline' })
                    return
                  }
                } catch (err) {
                  console.error('[sena][codex] PreToolUse hook error:', err)
                  // Fall through to default approval policy
                }
              }

              const decision = approvalPolicy === 'never' ? 'acceptForSession' : 'accept'
              client.respond(msg.id, { decision })
              break
            }
            default:
              // Unknown server request — accept to avoid blocking
              client.respond(msg.id, { decision: 'accept' })
              break
          }
        }

        handleApproval().catch((err) => {
          console.error('[sena][codex] Approval handler error:', err)
          client.respond(msg.id, { decision: 'accept' })
        })
      })

      abortSignal.addEventListener('abort', () => {
        client.close()
        turnDone = true
        resolveWait?.()
      }, { once: true })

      try {
        client.spawn(configOverrides.length ? configOverrides : undefined)
        await client.initialize('sena-runtime')

        const baseInstructions = buildBaseInstructions(contextFragments)
        const { prepend, append } = buildMessageWrappers(contextFragments)
        const resolvedModel = streamOptions.model || model

        const threadParams: Record<string, unknown> = {
          cwd: cwd || process.cwd(),
          approvalPolicy,
          sandbox: sandboxModeToCodex(sandboxMode),
          baseInstructions,
        }
        if (resolvedModel) threadParams.model = resolvedModel

        let threadId: string
        if (sessionId) {
          await client.threadResume(sessionId, threadParams)
          threadId = sessionId
        } else {
          const thread = await client.threadStart(threadParams as any)
          threadId = thread.threadId
          pushEvent({ type: 'session.init', sessionId: threadId })
        }

        let userText = ''
        for await (const msg of promptIterable) {
          userText = wrapUserMessage(msg.text, prepend, append)
          break
        }

        const { turnId } = await client.turnStart(threadId, userText)
        expectedTurnId = turnId

        while (!turnDone) {
          while (eventQueue.length > 0) {
            const event = eventQueue.shift()!
            yield event

            // After tool.end, check for pending messages to steer
            if (event.type === 'tool.end' && pendingMessages && expectedTurnId) {
              const pending = pendingMessages.drain()
              if (pending.length > 0) {
                const steerText = pending.join('\n')
                console.log(`[runtime-codex] steering with ${pending.length} pending message(s)`)
                try {
                  const steerResult = await client.turnSteer(threadId, steerText, expectedTurnId)
                  expectedTurnId = steerResult.turnId
                  console.log(`[runtime-codex] steered — new turn ${expectedTurnId.slice(0, 8)}`)
                } catch (err) {
                  console.error(`[runtime-codex] steer failed, restoring messages to pending:`, err)
                  // Put messages back so executeTurnWithSteer can process them as follow-up turns
                  pendingMessages.restore(pending)
                }
              }
            }
          }
          if (turnDone) break
          await new Promise<void>((resolve) => {
            resolveWait = resolve
            if (eventQueue.length > 0 || turnDone) resolve()
          })
        }

        while (eventQueue.length > 0) {
          yield eventQueue.shift()!
        }
      } finally {
        client.close()
        if (bridge) await bridge.close()
      }
    },
  }
}

function buildBaseInstructions(fragments: ContextFragment[]): string {
  const parts: string[] = []
  for (const f of fragments.filter(f => f.role === 'system')) {
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

function extractToolNameFromApproval(method: string, params: Record<string, unknown> | undefined): string {
  const item = params?.item as Record<string, unknown> | undefined
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return `shell:${(item?.command as string) ?? (params?.command as string) ?? 'unknown'}`
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return `file:${(item?.path as string) ?? (params?.path as string) ?? 'unknown'}`
    case 'item/permissions/requestApproval':
      return `permissions:${(item?.type as string) ?? 'unknown'}`
    default:
      return `unknown:${method}`
  }
}

function extractToolInputFromApproval(method: string, params: Record<string, unknown> | undefined): Record<string, unknown> {
  const item = params?.item as Record<string, unknown> | undefined
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return { command: item?.command ?? params?.command, args: item?.args ?? params?.args }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return { path: item?.path ?? params?.path, changes: item?.changes ?? params?.changes }
    case 'item/permissions/requestApproval':
      return { type: item?.type ?? params?.type }
    default:
      return params ?? {}
  }
}

// codex-cli 0.114.0 expects the legacy string form here, not the newer tagged union.
function sandboxModeToCodex(mode: string): string {
  switch (mode) {
    case 'danger-full-access':
      return 'danger-full-access'
    case 'read-only':
      return 'read-only'
    case 'workspace-write':
      return 'workspace-write'
    default:
      return 'workspace-write'
  }
}
