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
    sandboxMode = 'danger-full-access',
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

        // Official: 'turn/completed'. Legacy/observed: 'turn/ended'.
        if (msg.method === 'turn/completed' || msg.method === 'turn/ended') {
          turnDone = true
          resolveWait?.()
        }
        // Official: 'error'. Legacy/observed: 'codex/event/error'.
        if (msg.method === 'error' || msg.method === 'codex/event/error') {
          turnDone = true
          resolveWait?.()
        }
      })

      // Server requests requiring client response (approval, input, etc.)
      client.on('server-request', (msg: { id: number; method: string; params: unknown }) => {
        switch (msg.method) {
          // Official approval request methods per ServerRequest.ts
          case 'item/commandExecution/requestApproval':
          case 'item/fileChange/requestApproval':
          case 'item/permissions/requestApproval':
          case 'applyPatchApproval':
          case 'execCommandApproval': {
            const decision = approvalPolicy === 'never' ? 'acceptForSession' : 'accept'
            client.respond(msg.id, { decision })
            break
          }
          default:
            // Unknown server request — accept to avoid blocking
            client.respond(msg.id, { decision: 'accept' })
            break
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

/**
 * Convert a simple sandbox mode string to the tagged-union SandboxPolicy
 * format required by the Codex App Server protocol.
 * @see SandboxPolicy.ts from `codex app-server generate-ts`
 */
function sandboxModeToCodex(mode: string): Record<string, unknown> {
  switch (mode) {
    case 'danger-full-access':
      return { type: 'danger-full-access' }
    case 'read-only':
      return { type: 'read-only' }
    case 'workspace-write':
      return { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false }
    default:
      return { type: 'workspace-write', network_access: false, exclude_tmpdir_env_var: false, exclude_slash_tmp: false }
  }
}
