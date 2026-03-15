import type { Runtime, RuntimeEvent, RuntimeStreamOptions, ContextFragment } from '@sena-ai/core'
import { CodexAppServerClient } from './client.js'
import { mapCodexNotification } from './mapper.js'

export type CodexRuntimeOptions = {
  model?: string
  apiKey?: string
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'never' | 'on-request' | 'always'
  codexBin?: string
}

export function codexRuntime(options: CodexRuntimeOptions = {}): Runtime {
  const {
    model,
    apiKey,
    reasoningEffort = 'medium',
    sandboxMode = 'workspace-write',
    approvalPolicy = 'never',
    codexBin = 'codex',
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
      } = streamOptions

      if (apiKey) {
        process.env.OPENAI_API_KEY = apiKey
      }

      const client = new CodexAppServerClient(codexBin)

      const eventQueue: RuntimeEvent[] = []
      let resolveWait: (() => void) | null = null
      let turnDone = false

      function pushEvent(event: RuntimeEvent) {
        eventQueue.push(event)
        resolveWait?.()
      }

      client.on('notification', (msg: { method: string; params: unknown }) => {
        const event = mapCodexNotification(msg.method, msg.params)
        if (event) pushEvent(event)

        if (msg.method === 'turn/completed' || msg.method === 'turn/ended') {
          turnDone = true
          resolveWait?.()
        }
        // Codex error events also terminate the turn
        if (msg.method === 'codex/event/error') {
          turnDone = true
          resolveWait?.()
        }
      })

      client.on('server-request', (msg: { id: number; method: string; params: unknown }) => {
        if (msg.method.includes('requestApproval')) {
          if (approvalPolicy === 'never') {
            client.respond(msg.id, { decision: 'acceptForSession' })
          } else {
            client.respond(msg.id, { decision: 'accept' })
          }
        }
      })

      abortSignal.addEventListener('abort', () => {
        client.close()
        turnDone = true
        resolveWait?.()
      }, { once: true })

      try {
        client.spawn()
        await client.initialize('sena-runtime')

        const baseInstructions = buildBaseInstructions(contextFragments)
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
          userText = msg.text
          break
        }

        await client.turnStart(threadId, userText)

        while (!turnDone) {
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!
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
      }
    },
  }
}

function buildBaseInstructions(fragments: ContextFragment[]): string {
  const parts: string[] = []
  for (const f of fragments.filter(f => f.role === 'system')) {
    parts.push(`[${f.source}]\n${f.content}`)
  }
  for (const f of fragments.filter(f => f.role === 'context')) {
    parts.push(`[${f.source}]\n${f.content}`)
  }
  return parts.join('\n\n')
}

function sandboxModeToCodex(mode: string): string {
  // Codex app-server expects the original kebab-case format as-is
  const valid = ['read-only', 'workspace-write', 'danger-full-access']
  return valid.includes(mode) ? mode : 'workspace-write'
}
