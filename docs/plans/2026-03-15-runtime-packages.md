> **Note:** 이 문서의 패키지 경로는 구조 변경 이전 기준입니다. 현재 구조는 README.md를 참조하세요.

# Runtime Packages Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@sena-ai/runtime-claude`와 `@sena-ai/runtime-codex` 패키지를 구현하여, 실제 LLM 런타임으로 `createAgent → processTurn` 파이프라인이 동작하도록 한다.

**Architecture:** 각 런타임은 `Runtime` 인터페이스(`createStream → AsyncGenerator<RuntimeEvent>`)를 구현한다. Claude는 `@anthropic-ai/claude-agent-sdk`의 `query()` 함수를 래핑하고, Codex는 `codex app-server` 프로세스를 spawn하여 JSON-RPC 2.0으로 통신한다.

**Tech Stack:** TypeScript 5.x, `@anthropic-ai/claude-agent-sdk`, `codex` CLI (app-server), vitest

---

## Chunk 1: @sena-ai/runtime-claude

### Task 1: Package Scaffolding

**Files:**
- Create: `packages/runtime-claude/package.json`
- Create: `packages/runtime-claude/tsconfig.json`
- Create: `packages/runtime-claude/src/index.ts`

- [ ] **Step 1: `packages/runtime-claude/package.json`**

```json
{
  "name": "@sena-ai/runtime-claude",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch"
  },
  "dependencies": {
    "@sena-ai/core": "workspace:*",
    "@anthropic-ai/claude-agent-sdk": "^0.2.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: `packages/runtime-claude/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Placeholder `src/index.ts`**

```ts
export { claudeRuntime } from './runtime.js'
export type { ClaudeRuntimeOptions } from './runtime.js'
```

- [ ] **Step 4: Add to root tsconfig references**

Add `{ "path": "packages/runtime-claude" }` to root tsconfig.json references array.

- [ ] **Step 5: `pnpm install`**

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-claude/ tsconfig.json pnpm-lock.yaml
git commit -m "chore: scaffold @sena-ai/runtime-claude package"
```

---

### Task 2: Claude Runtime Implementation

**Files:**
- Create: `packages/runtime-claude/src/runtime.ts`
- Create: `packages/runtime-claude/src/mapper.ts`

- [ ] **Step 1: Create `mapper.ts` — SDK message → RuntimeEvent 변환**

```ts
// packages/runtime-claude/src/mapper.ts
import type { RuntimeEvent } from '@sena-ai/core'

/**
 * Claude Agent SDK의 SDKMessage를 Sena RuntimeEvent 배열로 변환한다.
 * 하나의 SDK 메시지가 여러 RuntimeEvent를 생성할 수 있다.
 */
export function mapSdkMessage(msg: any): RuntimeEvent[] {
  const events: RuntimeEvent[] = []

  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init' && msg.session_id) {
        events.push({ type: 'session.init', sessionId: msg.session_id })
      }
      break

    case 'assistant': {
      // Extract text content from assistant message
      const content = msg.message?.content
      if (Array.isArray(content)) {
        // Check for tool use blocks
        for (const block of content) {
          if (block.type === 'tool_use') {
            events.push({ type: 'tool.start', toolName: block.name ?? 'unknown' })
          }
        }
        // Extract text
        const text = content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('')
        if (text) {
          events.push({ type: 'progress', text })
        }
      }
      break
    }

    case 'result': {
      const text = msg.result ?? ''
      if (msg.subtype === 'success') {
        events.push({ type: 'result', text })
      } else {
        const errorMsg = Array.isArray(msg.errors) ? msg.errors.join('; ') : 'Unknown error'
        events.push({ type: 'error', message: errorMsg })
      }
      break
    }
  }

  return events
}
```

- [ ] **Step 2: Create `runtime.ts` — claudeRuntime factory**

```ts
// packages/runtime-claude/src/runtime.ts
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
        break // only take first message
      }

      // Build SDK options
      const sdkOptions: Record<string, any> = {
        model: streamOptions.model || model,
        maxTurns,
        cwd: cwd || process.cwd(),
        permissionMode,
        allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
        abortController: abortSignalToController(abortSignal),
        systemPrompt,
        settingSources: [],
      }

      if (apiKey) {
        sdkOptions.env = { ...envVars, ANTHROPIC_API_KEY: apiKey }
      } else if (Object.keys(envVars).length > 0) {
        sdkOptions.env = envVars
      }

      if (Object.keys(mcpServers).length > 0) {
        sdkOptions.mcpServers = mcpServers
        sdkOptions.allowedTools = allowedTools
      }

      // Resume session if available
      if (sessionId) {
        sdkOptions.resume = sessionId
      }

      // Run query
      const stream = query({ prompt: userText, options: sdkOptions })

      let lastToolName: string | undefined

      for await (const msg of stream) {
        const events = mapSdkMessage(msg)
        for (const event of events) {
          yield event
        }
      }
    },
  }
}

// === Internal helpers ===

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

function abortSignalToController(signal: AbortSignal): AbortController {
  const controller = new AbortController()
  if (signal.aborted) {
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller
}
```

- [ ] **Step 3: Build 확인**

Run: `pnpm -r run build`

- [ ] **Step 4: Commit**

```bash
git add packages/runtime-claude/src/
git commit -m "feat(runtime-claude): implement claudeRuntime with Agent SDK query()"
```

---

### Task 3: Claude Runtime Unit Tests

**Files:**
- Create: `packages/runtime-claude/src/__tests__/mapper.test.ts`

- [ ] **Step 1: mapper 테스트 작성**

```ts
import { describe, it, expect } from 'vitest'
import { mapSdkMessage } from '../mapper.js'

describe('mapSdkMessage', () => {
  it('maps system init to session.init', () => {
    const events = mapSdkMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-123',
      tools: [],
      mcp_servers: [],
      model: 'claude-sonnet-4-5',
    })
    expect(events).toEqual([{ type: 'session.init', sessionId: 'sess-123' }])
  })

  it('maps assistant text to progress', () => {
    const events = mapSdkMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    })
    expect(events).toEqual([{ type: 'progress', text: 'Hello world' }])
  })

  it('maps assistant tool_use to tool.start', () => {
    const events = mapSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'Reading file...' },
        ],
      },
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'tool.start', toolName: 'Read' })
    expect(events[1]).toEqual({ type: 'progress', text: 'Reading file...' })
  })

  it('maps success result to result', () => {
    const events = mapSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'Final answer',
      session_id: 'sess-123',
    })
    expect(events).toEqual([{ type: 'result', text: 'Final answer' }])
  })

  it('maps error result to error', () => {
    const events = mapSdkMessage({
      type: 'result',
      subtype: 'error_max_turns',
      errors: ['Max turns reached'],
      session_id: 'sess-123',
    })
    expect(events).toEqual([{ type: 'error', message: 'Max turns reached' }])
  })

  it('returns empty array for unknown message types', () => {
    expect(mapSdkMessage({ type: 'unknown' })).toEqual([])
  })
})
```

- [ ] **Step 2: 테스트 실행**

Run: `pnpm vitest run packages/runtime-claude/src/__tests__/mapper.test.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/runtime-claude/src/__tests__/
git commit -m "test(runtime-claude): add mapper unit tests"
```

---

## Chunk 2: @sena-ai/runtime-codex

### Task 4: Package Scaffolding

**Files:**
- Create: `packages/runtime-codex/package.json`
- Create: `packages/runtime-codex/tsconfig.json`
- Create: `packages/runtime-codex/src/index.ts`

- [ ] **Step 1: `packages/runtime-codex/package.json`**

```json
{
  "name": "@sena-ai/runtime-codex",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch"
  },
  "dependencies": {
    "@sena-ai/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

NOTE: No external SDK dependency — we communicate with `codex app-server` via stdio JSON-RPC.

- [ ] **Step 2: `packages/runtime-codex/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Placeholder `src/index.ts`**

```ts
export { codexRuntime } from './runtime.js'
export type { CodexRuntimeOptions } from './runtime.js'
```

- [ ] **Step 4: Add to root tsconfig references**

Add `{ "path": "packages/runtime-codex" }` to root tsconfig.json references array.

- [ ] **Step 5: `pnpm install`**

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-codex/ tsconfig.json pnpm-lock.yaml
git commit -m "chore: scaffold @sena-ai/runtime-codex package"
```

---

### Task 5: Codex JSON-RPC Client

Core JSON-RPC 2.0 client for communicating with `codex app-server` over stdio.

**Files:**
- Create: `packages/runtime-codex/src/client.ts`
- Create: `packages/runtime-codex/src/__tests__/client.test.ts`

- [ ] **Step 1: `client.ts` 구현**

```ts
// packages/runtime-codex/src/client.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'

export type JsonRpcMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcess | null = null
  private rl: Interface | null = null
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private codexBin: string

  constructor(codexBin = 'codex') {
    super()
    this.codexBin = codexBin
  }

  spawn(): void {
    this.child = spawn(this.codexBin, ['app-server'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    this.rl = createInterface({ input: this.child.stdout! })
    this.rl.on('line', (line) => this.onLine(line))

    this.child.on('error', (err) => this.emit('error', err))
    this.child.on('exit', (code) => this.emit('exit', code))
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return // ignore malformed lines
    }

    // Response to a client request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message))
      } else {
        resolve(msg.result)
      }
      return
    }

    // Server request (has id but no pending — requires client response)
    if (msg.id !== undefined && msg.method) {
      this.emit('server-request', msg)
      return
    }

    // Server notification (no id)
    if (msg.method) {
      this.emit(msg.method, msg.params)
      this.emit('notification', msg)
    }
  }

  private send(msg: object): void {
    if (!this.child?.stdin?.writable) throw new Error('Client not connected')
    // NOTE: jsonrpc field is omitted on wire per Codex protocol
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  request(method: string, params: object): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, method, params })
    })
  }

  notify(method: string, params: object = {}): void {
    this.send({ method, params })
  }

  respond(id: number, result: unknown): void {
    this.send({ id, result })
  }

  async initialize(clientName = 'sena-runtime', version = '0.1.0'): Promise<unknown> {
    const result = await this.request('initialize', {
      clientInfo: { name: clientName, version },
      capabilities: { experimentalApi: false },
    })
    this.notify('initialized')
    return result
  }

  async threadStart(params: {
    model?: string
    cwd?: string
    approvalPolicy?: string
    sandbox?: string
    baseInstructions?: string
  }): Promise<{ threadId: string }> {
    return this.request('thread/start', {
      ...params,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    }) as Promise<{ threadId: string }>
  }

  async threadResume(threadId: string, params: object = {}): Promise<unknown> {
    return this.request('thread/resume', {
      threadId,
      ...params,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })
  }

  async turnStart(threadId: string, text: string, params: object = {}): Promise<unknown> {
    return this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
      persistExtendedHistory: true,
      ...params,
    })
  }

  close(): void {
    this.rl?.close()
    this.child?.kill()
    this.child = null
    this.rl = null
    // Reject all pending requests
    for (const [, { reject }] of this.pending) {
      reject(new Error('Client closed'))
    }
    this.pending.clear()
  }
}
```

- [ ] **Step 2: 클라이언트 테스트** (mock child process)

```ts
// packages/runtime-codex/src/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodexAppServerClient } from '../client.js'

// We test the JSON parsing and event routing logic by simulating stdout lines
describe('CodexAppServerClient', () => {
  it('can be instantiated', () => {
    const client = new CodexAppServerClient('codex')
    expect(client).toBeDefined()
  })

  // Note: Full integration tests with actual codex process require codex to be installed.
  // The mapper tests (Task 6) cover the event transformation logic.
})
```

- [ ] **Step 3: Build 확인**

Run: `pnpm -r run build`

- [ ] **Step 4: Commit**

```bash
git add packages/runtime-codex/src/
git commit -m "feat(runtime-codex): implement JSON-RPC client for codex app-server"
```

---

### Task 6: Codex Event Mapper

**Files:**
- Create: `packages/runtime-codex/src/mapper.ts`
- Create: `packages/runtime-codex/src/__tests__/mapper.test.ts`

- [ ] **Step 1: `mapper.ts` 구현**

```ts
// packages/runtime-codex/src/mapper.ts
import type { RuntimeEvent } from '@sena-ai/core'

/**
 * Codex App Server 노티피케이션을 Sena RuntimeEvent로 변환한다.
 */
export function mapCodexNotification(method: string, params: any): RuntimeEvent | null {
  switch (method) {
    case 'item/agentMessage/delta':
      return { type: 'progress.delta', text: params.delta ?? '' }

    case 'item/started': {
      const itemType = params.item?.type ?? params.type
      if (itemType === 'commandExecution' || itemType === 'fileChange') {
        const toolName = itemType === 'commandExecution'
          ? `shell:${params.item?.command ?? 'unknown'}`
          : `file:${params.item?.path ?? 'unknown'}`
        return { type: 'tool.start', toolName }
      }
      return null
    }

    case 'item/completed': {
      const item = params.item
      if (!item) return null
      const itemType = item.type
      if (itemType === 'commandExecution' || itemType === 'fileChange') {
        const toolName = itemType === 'commandExecution'
          ? `shell:${item.command ?? 'unknown'}`
          : `file:${item.path ?? 'unknown'}`
        const isError = item.exitCode !== undefined ? item.exitCode !== 0 : false
        return { type: 'tool.end', toolName, isError }
      }
      if (itemType === 'agentMessage') {
        // Agent message completed — extract full text for progress
        const text = item.content
          ?.filter((b: any) => b.type === 'text')
          ?.map((b: any) => b.text)
          ?.join('') ?? ''
        if (text) {
          return { type: 'progress', text }
        }
      }
      return null
    }

    case 'turn/completed': {
      const turn = params.turn
      if (!turn) return null
      if (turn.status === 'completed') {
        // Extract final text from last agent message item
        const agentItems = (turn.items ?? []).filter((i: any) => i.type === 'agentMessage')
        const lastMsg = agentItems[agentItems.length - 1]
        const text = lastMsg?.content
          ?.filter((b: any) => b.type === 'text')
          ?.map((b: any) => b.text)
          ?.join('') ?? ''
        return { type: 'result', text }
      }
      if (turn.status === 'failed') {
        return { type: 'error', message: turn.error ?? 'Turn failed' }
      }
      // interrupted
      return { type: 'error', message: 'Turn interrupted' }
    }

    case 'error':
      return { type: 'error', message: params.error?.message ?? 'Unknown error' }

    default:
      return null
  }
}
```

- [ ] **Step 2: mapper 테스트**

```ts
// packages/runtime-codex/src/__tests__/mapper.test.ts
import { describe, it, expect } from 'vitest'
import { mapCodexNotification } from '../mapper.js'

describe('mapCodexNotification', () => {
  it('maps agentMessage delta to progress.delta', () => {
    const event = mapCodexNotification('item/agentMessage/delta', {
      threadId: 'thr_1', turnId: 'turn_1', itemId: 'item_1',
      delta: 'Hello ',
    })
    expect(event).toEqual({ type: 'progress.delta', text: 'Hello ' })
  })

  it('maps commandExecution item/started to tool.start', () => {
    const event = mapCodexNotification('item/started', {
      item: { type: 'commandExecution', command: 'ls -la' },
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'shell:ls -la' })
  })

  it('maps commandExecution item/completed to tool.end', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'npm test', exitCode: 0 },
    })
    expect(event).toEqual({ type: 'tool.end', toolName: 'shell:npm test', isError: false })
  })

  it('maps failed command to tool.end with isError', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'bad-cmd', exitCode: 1 },
    })
    expect(event).toEqual({ type: 'tool.end', toolName: 'shell:bad-cmd', isError: true })
  })

  it('maps turn/completed success to result', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: {
        status: 'completed',
        items: [
          { type: 'agentMessage', content: [{ type: 'text', text: 'Done!' }] },
        ],
      },
    })
    expect(event).toEqual({ type: 'result', text: 'Done!' })
  })

  it('maps turn/completed failed to error', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: { status: 'failed', error: 'Context window exceeded' },
    })
    expect(event).toEqual({ type: 'error', message: 'Context window exceeded' })
  })

  it('maps error notification to error event', () => {
    const event = mapCodexNotification('error', {
      error: { message: 'Server crashed' },
    })
    expect(event).toEqual({ type: 'error', message: 'Server crashed' })
  })

  it('returns null for unrelated notifications', () => {
    expect(mapCodexNotification('thread/name/updated', {})).toBeNull()
    expect(mapCodexNotification('account/updated', {})).toBeNull()
  })
})
```

- [ ] **Step 3: 테스트 실행**

Run: `pnpm vitest run packages/runtime-codex/src/__tests__/mapper.test.ts`

- [ ] **Step 4: Commit**

```bash
git add packages/runtime-codex/src/
git commit -m "feat(runtime-codex): implement event mapper for app-server notifications"
```

---

### Task 7: Codex Runtime Factory

**Files:**
- Create: `packages/runtime-codex/src/runtime.ts`
- Modify: `packages/runtime-codex/src/index.ts`

- [ ] **Step 1: `runtime.ts` 구현**

```ts
// packages/runtime-codex/src/runtime.ts
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
    model = 'o4-mini',
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
        env: envVars,
        abortSignal,
      } = streamOptions

      // Set API key in environment if provided
      if (apiKey) {
        process.env.OPENAI_API_KEY = apiKey
      }

      const client = new CodexAppServerClient(codexBin)

      // Queue for events to yield
      const eventQueue: RuntimeEvent[] = []
      let resolveWait: (() => void) | null = null
      let turnDone = false
      let turnError: Error | null = null

      function pushEvent(event: RuntimeEvent) {
        eventQueue.push(event)
        resolveWait?.()
      }

      // Listen for notifications
      client.on('notification', (msg: { method: string; params: unknown }) => {
        const event = mapCodexNotification(msg.method, msg.params)
        if (event) pushEvent(event)

        // Detect turn end
        if (msg.method === 'turn/completed') {
          turnDone = true
          resolveWait?.()
        }
      })

      // Handle approval requests — auto-respond based on policy
      client.on('server-request', (msg: { id: number; method: string; params: unknown }) => {
        if (msg.method.includes('requestApproval')) {
          if (approvalPolicy === 'never') {
            client.respond(msg.id, { decision: 'acceptForSession' })
          } else {
            // For on-request/always, default to accept (TODO: hook into Sena approval pipeline)
            client.respond(msg.id, { decision: 'accept' })
          }
        }
      })

      // Handle abort
      abortSignal.addEventListener('abort', () => {
        client.close()
        turnDone = true
        resolveWait?.()
      }, { once: true })

      try {
        // Spawn and initialize
        client.spawn()
        await client.initialize('sena-runtime')

        // Build base instructions from context fragments
        const baseInstructions = buildBaseInstructions(contextFragments)

        // Start or resume thread
        let threadId: string
        if (sessionId) {
          await client.threadResume(sessionId, {
            model: streamOptions.model || model,
            cwd: cwd || process.cwd(),
            approvalPolicy,
            sandbox: sandboxModeToCodex(sandboxMode),
            baseInstructions,
          })
          threadId = sessionId
        } else {
          const thread = await client.threadStart({
            model: streamOptions.model || model,
            cwd: cwd || process.cwd(),
            approvalPolicy,
            sandbox: sandboxModeToCodex(sandboxMode),
            baseInstructions,
          })
          threadId = thread.threadId
          pushEvent({ type: 'session.init', sessionId: threadId })
        }

        // Get user message
        let userText = ''
        for await (const msg of promptIterable) {
          userText = msg.text
          break
        }

        // Start turn
        await client.turnStart(threadId, userText)

        // Yield events as they come
        while (!turnDone) {
          // Drain queue
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!
          }

          if (turnDone) break

          // Wait for more events
          await new Promise<void>((resolve) => {
            resolveWait = resolve
            // Check if events arrived while we were setting up
            if (eventQueue.length > 0 || turnDone) resolve()
          })
        }

        // Drain remaining events
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!
        }
      } finally {
        client.close()
      }
    },
  }
}

// === Internal helpers ===

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
  switch (mode) {
    case 'read-only': return 'readonly'
    case 'workspace-write': return 'workspaceWrite'
    case 'danger-full-access': return 'dangerFullAccess'
    default: return 'workspaceWrite'
  }
}
```

- [ ] **Step 2: index.ts 최종**

```ts
export { codexRuntime } from './runtime.js'
export type { CodexRuntimeOptions } from './runtime.js'
export { CodexAppServerClient } from './client.js'
export { mapCodexNotification } from './mapper.js'
```

- [ ] **Step 3: Build 확인**

Run: `pnpm -r run build`

- [ ] **Step 4: Commit**

```bash
git add packages/runtime-codex/src/
git commit -m "feat(runtime-codex): implement codexRuntime with app-server JSON-RPC"
```

---

## Chunk 3: 스펙 업데이트 및 전체 검증

### Task 8: 타입 업데이트 및 전체 검증

types.ts에 `progress.delta` RuntimeEvent 추가 (Codex 스트리밍용).

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: RuntimeEvent 타입에 progress.delta 추가**

`progress.delta` 이벤트 타입이 이미 스펙에 있는지 확인 후 types.ts에 추가.

- [ ] **Step 2: 전체 테스트 실행**

Run: `pnpm vitest run`

- [ ] **Step 3: 전체 빌드 실행**

Run: `pnpm -r run build`

- [ ] **Step 4: Commit & Push**

```bash
git add -A
git commit -m "feat(core): add progress.delta event type for token streaming"
git push origin v2
```
