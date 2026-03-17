import type {
  Runtime,
  ToolPort,
  TurnStartHook,
  TurnEndHook,
  ErrorHook,
  TurnContext,
  TurnResult,
  TurnTrace,
  HookTrace,
  ContextFragment,
  RuntimeEvent,
} from './types.js'
import { randomUUID } from 'node:crypto'

export type TurnEngineConfig = {
  name: string
  cwd: string
  runtime: Runtime
  hooks: {
    onTurnStart?: TurnStartHook[]
    onTurnEnd?: TurnEndHook[]
    onError?: ErrorHook[]
  }
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
      allFragments.push({ source: 'connector-meta', role: 'context', content: `[Current Message Context] ${parts}` })
    }

    // === onTurnStart hooks ===
    for (const hook of hooks.onTurnStart ?? []) {
      const hookStart = performance.now()
      const fragments = await hook.execute(context)
      hookTraces.push({
        phase: 'onTurnStart',
        name: hook.name,
        durationMs: Math.round(performance.now() - hookStart),
        fragments,
      })
      allFragments.push(...fragments)
    }

    // === Assemble context ===
    const assembledContext = assembleContext(allFragments)

    // === Run runtime ===
    let result: TurnResult | null = null
    let error: string | null = null

    try {
      const runtimeResult = await executeRuntime(runtime, {
        contextFragments: allFragments,
        input: options.input,
        tools,
        sessionId: options.sessionId ?? null,
        cwd,
        abortSignal: options.abortSignal,
        onEvent: options.onEvent,
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

      for (const hook of hooks.onError ?? []) {
        const hookStart = performance.now()
        try {
          await hook.execute(context, err instanceof Error ? err : new Error(String(err)))
        } catch {
          // error hooks should not throw
        }
        hookTraces.push({
          phase: 'onError',
          name: hook.name,
          durationMs: Math.round(performance.now() - hookStart),
          fragments: [],
        })
      }
    }

    // === onTurnEnd hooks ===
    if (result) {
      for (const hook of hooks.onTurnEnd ?? []) {
        const hookStart = performance.now()
        await hook.execute(context, result)
        hookTraces.push({
          phase: 'onTurnEnd',
          name: hook.name,
          durationMs: Math.round(performance.now() - hookStart),
          fragments: [],
        })
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
    }
  }

  return { processTurn }
}

// === Internal helpers ===

function assembleContext(fragments: ContextFragment[]): string {
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
  },
): Promise<RuntimeExecutionResult> {
  const { contextFragments, input, tools, sessionId, cwd, abortSignal, onEvent } = options

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
