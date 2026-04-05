import type {
  Runtime,
  ToolPort,
  TurnContext,
  TurnResult,
  TurnTrace,
  HookTrace,
  ContextFragment,
  RuntimeEvent,
  PendingMessageSource,
} from './types.js'
import type { RuntimeHooks, TurnEndInput, ErrorInput, TurnStartInput } from './runtime-hooks.js'
import { randomUUID } from 'node:crypto'

export type TurnEngineConfig = {
  name: string
  cwd: string
  runtime: Runtime
  hooks?: RuntimeHooks
  tools: ToolPort[]
}

export type ProcessTurnOptions = {
  input: string
  trigger?: 'connector' | 'schedule' | 'programmatic'
  sessionId?: string | null
  connector?: TurnContext['connector']
  schedule?: TurnContext['schedule']
  metadata?: Record<string, unknown>
  abortSignal?: AbortSignal
  onEvent?: (event: RuntimeEvent) => void
  /** Pending messages to inject via steer at step (tool.end) boundaries. */
  pendingMessages?: PendingMessageSource
  /** Tool names/patterns to disable for this turn (blocklist). */
  disabledTools?: string[]
}

export function createTurnEngine(config: TurnEngineConfig) {
  const { name, cwd, runtime, hooks, tools } = config

  async function processTurn(options: ProcessTurnOptions): Promise<TurnTrace> {
    const turnId = randomUUID()
    const timestamp = new Date().toISOString()
    const trigger = options.trigger ?? 'programmatic'
    const startTime = performance.now()

    console.log(`[engine] turn ${turnId.slice(0, 8)} start — trigger:${trigger}, input:"${options.input.slice(0, 80)}"`)

    const context: TurnContext = {
      turnId,
      agentName: name,
      trigger,
      input: options.input,
      connector: options.connector,
      schedule: options.schedule,
      sessionId: options.sessionId ?? null,
      metadata: options.metadata ?? {},
    }

    const hookTraces: HookTrace[] = []
    const allFragments: ContextFragment[] = []

    // === Auto-inject connector context ===
    if (options.connector) {
      const c = options.connector
      // Parse conversationId (format: "channelId:threadTs" for Slack)
      const [channelId, threadTs] = c.conversationId.includes(':')
        ? c.conversationId.split(':')
        : [c.conversationId, undefined]
      const parts = [
        `connector: ${c.name}`,
        `channelId: ${channelId}`,
        threadTs ? `threadTs: ${threadTs}` : null,
        `userId: ${c.userId}`,
        c.userName && c.userName !== c.userId ? `userName: ${c.userName}` : null,
      ].filter(Boolean).join(', ')
      let contextContent = `[Current Message Context] ${parts}`
      if (c.files?.length) {
        const fileDescs = c.files.map(f => {
          if (f.localPath) return `${f.name} (${f.mimeType}) → ${f.localPath}`
          return `${f.name} (${f.mimeType}, id:${f.id})`
        }).join(', ')
        const hasLocal = c.files.some(f => f.localPath)
        const hint = hasLocal
          ? 'Use the Read tool to view the file contents directly.'
          : 'Use slack_download_file with the file id to download and view file contents.'
        contextContent += `\n[Attached Files] ${fileDescs} — ${hint}`
      }
      allFragments.push({ source: 'connector-meta', role: 'append', content: contextContent })
    }

    // === onTurnStart hooks ===
    for (const callback of hooks?.onTurnStart ?? []) {
      try {
        const turnStartInput: TurnStartInput = {
          hookEventName: 'turnStart',
          prompt: options.input,
          turnContext: context,
        }
        const decision = await callback(turnStartInput)
        if (decision.decision === 'block') {
          console.log(`[engine] turn ${turnId.slice(0, 8)} blocked by onTurnStart hook: ${decision.reason}`)
          return {
            turnId,
            timestamp,
            agentName: name,
            trigger,
            input: options.input,
            hooks: hookTraces,
            assembledContext: '',
            result: null,
            error: `Blocked by onTurnStart hook: ${decision.reason}`,
          }
        }
        if ('fragments' in decision && decision.fragments) {
          allFragments.push(...decision.fragments)
        }
      } catch (hookErr) {
        console.error(`[engine] onTurnStart hook threw:`, hookErr)
      }
    }

    // === Assemble context ===
    const assembledContext = assembleContext(allFragments)

    // === Run runtime ===
    let result: TurnResult | null = null
    let error: string | null = null

    try {
      // Filter out ToolPorts whose name exactly matches a disabledTools entry.
      // Remaining patterns (wildcards, individual tool names) are forwarded to
      // the runtime for runtime-specific handling (e.g. built-in tools).
      const disabledTools = options.disabledTools
      const effectiveTools = disabledTools?.length
        ? tools.filter(t => !disabledTools.includes(t.name))
        : tools

      const runtimeResult = await executeRuntime(runtime, {
        contextFragments: allFragments,
        input: options.input,
        tools: effectiveTools,
        sessionId: options.sessionId ?? null,
        cwd,
        abortSignal: options.abortSignal,
        onEvent: options.onEvent,
        pendingMessages: options.pendingMessages,
        disabledTools,
        hooks: hooks ? { ...hooks, onTurnStart: undefined } : undefined,
      })
      result = {
        text: runtimeResult.text,
        sessionId: runtimeResult.sessionId,
        durationMs: Math.round(performance.now() - startTime),
        toolCalls: runtimeResult.toolCalls,
      }
      context.sessionId = runtimeResult.sessionId
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      console.error(`[engine] turn ${turnId.slice(0, 8)} error:`, error)

      // === RuntimeHooks onError ===
      const errorInput: ErrorInput = {
        hookEventName: 'error',
        error: err instanceof Error ? err : new Error(String(err)),
        turnContext: context,
      }
      for (const callback of hooks?.onError ?? []) {
        try {
          await callback(errorInput)
        } catch (hookErr) {
          console.error(`[engine] hooks.onError threw:`, hookErr)
        }
      }
    }

    // === onTurnEnd hooks (RuntimeHooks) ===
    const followUps: import('./types.js').TurnFollowUp[] = []
    if (result) {
      const turnEndInput: TurnEndInput = {
        hookEventName: 'turnEnd',
        result,
        turnContext: context,
      }
      const isForkedTurn = context.metadata.forkedFrom != null
      for (const callback of hooks?.onTurnEnd ?? []) {
        try {
          const hookResult = await callback(turnEndInput)
          if (hookResult && typeof hookResult === 'object' && hookResult.followUp) {
            // Ignore fork from forked turns (1-level depth limit)
            const fork = isForkedTurn ? false : (hookResult.fork ?? false)
            followUps.push({
              prompt: hookResult.followUp,
              fork,
              detached: fork ? (hookResult.detached ?? false) : false,
            })
          }
        } catch (hookErr) {
          console.error(`[engine] hooks.onTurnEnd threw:`, hookErr)
        }
      }
    }

    const duration = Math.round(performance.now() - startTime)
    console.log(`[engine] turn ${turnId.slice(0, 8)} done — ${duration}ms, result:${result ? result.text.length + 'ch' : 'null'}, error:${error ?? 'none'}`)

    return {
      turnId,
      timestamp,
      agentName: name,
      trigger,
      input: options.input,
      hooks: hookTraces,
      assembledContext,
      result,
      error,
      followUps: followUps.length > 0 ? followUps : undefined,
    }
  }

  return { processTurn }
}

// === Internal helpers ===

function assembleContext(fragments: ContextFragment[]): string {
  const systemFragments = fragments.filter(f => f.role === 'system')
  const prependFragments = fragments.filter(f => f.role === 'prepend')
  const appendFragments = fragments.filter(f => f.role === 'append')

  const parts: string[] = []

  for (const f of systemFragments) {
    parts.push(`[${f.source}]\n${f.content}`)
  }
  for (const f of prependFragments) {
    parts.push(`[prepend:${f.source}]\n${f.content}`)
  }
  for (const f of appendFragments) {
    parts.push(`[append:${f.source}]\n${f.content}`)
  }

  return parts.join('\n\n')
}

type RuntimeExecutionResult = {
  text: string
  sessionId: string | null
  toolCalls: { toolName: string; durationMs: number; isError: boolean }[]
}

async function executeRuntime(
  runtime: Runtime,
  options: {
    contextFragments: ContextFragment[]
    input: string
    tools: ToolPort[]
    sessionId: string | null
    cwd: string
    abortSignal?: AbortSignal
    onEvent?: (event: RuntimeEvent) => void
    pendingMessages?: PendingMessageSource
    disabledTools?: string[]
    hooks?: RuntimeHooks
  },
): Promise<RuntimeExecutionResult> {
  const { contextFragments, input, tools, sessionId, cwd, abortSignal, onEvent, pendingMessages, disabledTools, hooks } = options

  async function* promptIterable() {
    yield { text: input }
  }

  const stream = runtime.createStream({
    model: '',
    contextFragments,
    prompt: promptIterable(),
    tools,
    sessionId,
    cwd,
    env: {},
    abortSignal: abortSignal ?? new AbortController().signal,
    pendingMessages,
    disabledTools,
    hooks,
  })

  let resultText = ''
  let progressText = '' // Accumulate progress/delta as fallback for result
  let resultSessionId: string | null = sessionId
  const toolCalls: { toolName: string; durationMs: number; isError: boolean }[] = []
  const toolStarts = new Map<string, number>()

  for await (const event of stream) {
    onEvent?.(event)

    switch (event.type) {
      case 'session.init':
        resultSessionId = event.sessionId
        console.log(`[runtime] session.init: ${event.sessionId}`)
        break
      case 'progress':
        progressText = event.text // Full progress replaces
        break
      case 'progress.delta':
        progressText += event.text // Deltas accumulate
        break
      case 'result':
        resultText = event.text
        console.log(`[runtime] result: ${event.text.length}ch`)
        break
      case 'tool.start':
        toolStarts.set(event.toolName, performance.now())
        console.log(`[runtime] tool.start: ${event.toolName}`)
        break
      case 'tool.end': {
        const start = toolStarts.get(event.toolName)
        const duration = start ? Math.round(performance.now() - start) : 0
        toolCalls.push({
          toolName: event.toolName,
          durationMs: duration,
          isError: event.isError,
        })
        toolStarts.delete(event.toolName)
        console.log(`[runtime] tool.end: ${event.toolName} ${duration}ms ${event.isError ? 'ERROR' : 'ok'}`)
        break
      }
    }
  }

  // Use accumulated progress text as fallback if result is empty
  const finalText = resultText || progressText
  return { text: finalText, sessionId: resultSessionId, toolCalls }
}
