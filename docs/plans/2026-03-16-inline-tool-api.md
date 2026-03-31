> **Note:** 이 문서의 패키지 경로는 구조 변경 이전 기준입니다. 현재 구조는 README.md를 참조하세요.

# Inline Tool API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `defineTool()` API to sena-v2 so tools can be defined inline without MCP server boilerplate, supporting both Claude and Codex runtimes.

**Architecture:** ToolPort becomes a discriminated union (`McpToolPort | InlineToolPort`). `defineTool()` creates `InlineToolPort` with handler+schema. Claude runtime registers inline tools as native SDK tools; Codex runtime spins up a localhost StreamableHTTP MCP server hosting inline tools, passing the URL via `-c` flag.

**Tech Stack:** TypeScript, Zod, zod-to-json-schema, @modelcontextprotocol/server, @modelcontextprotocol/node, Vitest

**Spec:** `docs/specs/2026-03-16-inline-tool-api-design.md`

---

## File Structure

**New files:**
- `packages/core/src/tool.ts` — `defineTool()`, `toolResult()`, `isBrandedToolResult()`, `paramsToJsonSchema()`, types
- `packages/core/src/__tests__/tool.test.ts` — Unit tests for tool.ts
- `packages/runtime-codex/src/inline-mcp-server.ts` — `startInlineMcpHttpServer()`, `normalizeToMcpResult()`
- `packages/runtime-codex/src/__tests__/inline-mcp-server.test.ts` — HTTP MCP bridge tests

**Modified files:**
- `packages/core/src/types.ts` — ToolPort discriminated union, new types
- `packages/core/src/index.ts` — Re-export tool.ts
- `packages/core/src/config.ts` — Add tool name collision check
- `packages/runtime-claude/src/runtime.ts` — `buildMcpServers()` → `buildToolConfig()`, inline tool support
- `packages/runtime-claude/src/__tests__/runtime.test.ts` — Updated tests (if exists, else mapper.test.ts)
- `packages/runtime-codex/src/runtime.ts` — Add tool handling to `createStream()`
- `packages/runtime-codex/src/client.ts` — Accept configOverrides in spawn args
- `packages/tools-slack/src/slackTools.ts` — Return `ToolPort[]` using `defineTool()`
- `packages/tools-slack/src/index.ts` — Update exports
- `packages/tools-slack/src/__tests__/slackTools.test.ts` — Update tests
- `packages/tools-slack/package.json` — Remove MCP SDK dep, add @sena-ai/core dep for defineTool

**Deleted files:**
- `packages/tools-slack/src/mcp-server.ts` — Replaced by inline tools
- `packages/tools-obsidian/` — Entire package (unused)

---

## Chunk 1: Core — defineTool API & Types

### Task 1: ToolPort Discriminated Union

**Files:**
- Modify: `packages/core/src/types.ts:163-171`

- [ ] **Step 1: Write failing test for new ToolPort type**

Create `packages/core/src/__tests__/tool.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('ToolPort type discrimination', () => {
  it('McpToolPort has toMcpConfig', () => {
    const mcp = {
      name: 'test',
      type: 'mcp-stdio' as const,
      toMcpConfig: () => ({ command: 'node' }),
    }
    expect(mcp.type).toBe('mcp-stdio')
    expect(typeof mcp.toMcpConfig).toBe('function')
  })

  it('InlineToolPort has inline field', () => {
    const inline = {
      name: 'test',
      type: 'inline' as const,
      inline: {
        description: 'test',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => 'ok',
      },
    }
    expect(inline.type).toBe('inline')
    expect(inline.inline.description).toBe('test')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/core/src/__tests__/tool.test.ts`
Expected: FAIL (file doesn't exist yet or types don't match)

- [ ] **Step 3: Update ToolPort types**

In `packages/core/src/types.ts`, replace lines 163-171:

```typescript
// Before:
// export type ToolPort = {
//   name: string
//   type: 'builtin' | 'mcp-http' | 'mcp-stdio'
//   toMcpConfig(runtime: RuntimeInfo): McpConfig
// }

// After:
export type McpToolPort = {
  name: string
  type: 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export type InlineToolDef = {
  description: string
  params?: Record<string, import('zod').ZodSchema>
  inputSchema: Record<string, unknown>
  handler: (params: any) => string | object | BrandedToolResult | Promise<string | object | BrandedToolResult>
}

export type InlineToolPort = {
  name: string
  type: 'inline'
  inline: InlineToolDef
}

export type ToolPort = McpToolPort | InlineToolPort
```

Also add `BrandedToolResult` type (the symbol-based brand will be in tool.ts, but the type needs to be importable):

```typescript
export type BrandedToolResult = {
  readonly __brand: unique symbol
  content: ToolContent[]
}
```

- [ ] **Step 4: Fix any type errors in existing code that references ToolPort**

Check: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`

The `buildMcpServers()` in runtime-claude calls `tool.toMcpConfig()` unconditionally. This will now need a type guard. Fix this temporarily by adding `as McpToolPort` cast or filtering — the proper fix comes in Task 4.

- [ ] **Step 5: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test`
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/__tests__/tool.test.ts
git commit -m "feat(core): ToolPort discriminated union — McpToolPort | InlineToolPort"
```

---

### Task 2: defineTool(), toolResult(), paramsToJsonSchema()

**Files:**
- Create: `packages/core/src/tool.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/__tests__/tool.test.ts`
- Modify: `packages/core/package.json` (add zod-to-json-schema)

- [ ] **Step 1: Install dependency**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm --filter @sena-ai/core add zod-to-json-schema`

- [ ] **Step 2: Write failing tests**

Append to `packages/core/src/__tests__/tool.test.ts`:

```typescript
import { defineTool, toolResult, isBrandedToolResult } from '../tool.js'
import { z } from 'zod'

describe('defineTool', () => {
  it('creates InlineToolPort with correct fields', () => {
    const tool = defineTool({
      name: 'weather',
      description: 'Get weather',
      params: { city: z.string() },
      handler: async ({ city }) => `${city}: sunny`,
    })
    expect(tool.name).toBe('weather')
    expect(tool.type).toBe('inline')
    expect(tool.inline.description).toBe('Get weather')
    expect(tool.inline.inputSchema).toHaveProperty('properties')
    expect((tool.inline.inputSchema as any).properties.city).toEqual({ type: 'string' })
    expect((tool.inline.inputSchema as any).required).toEqual(['city'])
  })

  it('handles optional params', () => {
    const tool = defineTool({
      name: 'greet',
      description: 'Greet',
      params: { name: z.string(), title: z.string().optional() },
      handler: async ({ name }) => `Hi ${name}`,
    })
    const schema = tool.inline.inputSchema as any
    expect(schema.required).toEqual(['name'])
    expect(schema.properties.title).toBeDefined()
  })

  it('creates parameterless tool', () => {
    const tool = defineTool({
      name: 'ping',
      description: 'Ping',
      handler: async () => 'pong',
    })
    expect(tool.inline.inputSchema).toEqual({ type: 'object', properties: {} })
  })

  it('handler is callable', async () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo',
      params: { msg: z.string() },
      handler: async ({ msg }) => msg,
    })
    const result = await tool.inline.handler({ msg: 'hello' })
    expect(result).toBe('hello')
  })
})

describe('toolResult', () => {
  it('creates branded result', () => {
    const result = toolResult([{ type: 'text', text: 'hello' }])
    expect(isBrandedToolResult(result)).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('plain objects are not branded', () => {
    expect(isBrandedToolResult({ content: [{ type: 'text', text: 'hi' }] })).toBe(false)
    expect(isBrandedToolResult('string')).toBe(false)
    expect(isBrandedToolResult(null)).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/core/src/__tests__/tool.test.ts`
Expected: FAIL (tool.ts doesn't exist)

- [ ] **Step 4: Implement tool.ts**

Create `packages/core/src/tool.ts`:

```typescript
import { z, type ZodSchema } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { InlineToolPort, ToolContent, InlineToolDef } from './types.js'

const TOOL_RESULT: unique symbol = Symbol('ToolResult')

export type BrandedToolResult = {
  [TOOL_RESULT]: true
  content: ToolContent[]
}

export type DefineToolOptions = {
  name: string
  description: string
  params?: Record<string, ZodSchema>
  handler: InlineToolDef['handler']
}

export function defineTool(options: DefineToolOptions): InlineToolPort {
  const inputSchema = options.params
    ? paramsToJsonSchema(options.params)
    : { type: 'object' as const, properties: {} }

  return {
    name: options.name,
    type: 'inline',
    inline: {
      description: options.description,
      params: options.params,
      inputSchema,
      handler: options.handler,
    },
  }
}

export function toolResult(content: ToolContent[]): BrandedToolResult {
  return { [TOOL_RESULT]: true, content }
}

export function isBrandedToolResult(value: unknown): value is BrandedToolResult {
  return typeof value === 'object' && value !== null && TOOL_RESULT in value
}

export function paramsToJsonSchema(params: Record<string, ZodSchema>): Record<string, unknown> {
  const schema = z.object(params)
  return zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>
}
```

- [ ] **Step 5: Update index.ts exports**

In `packages/core/src/index.ts`, add:

```typescript
export { defineTool, toolResult, isBrandedToolResult, paramsToJsonSchema } from './tool.js'
export type { DefineToolOptions, BrandedToolResult } from './tool.js'
```

- [ ] **Step 6: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/core/src/__tests__/tool.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/core/
git commit -m "feat(core): implement defineTool(), toolResult(), paramsToJsonSchema()"
```

---

### Task 3: Tool Name Collision Check in defineConfig

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/__tests__/config.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/__tests__/config.test.ts`:

```typescript
import { defineConfig } from '../config.js'
import { defineTool } from '../tool.js'

describe('defineConfig tool name validation', () => {
  it('throws on duplicate tool names', () => {
    expect(() =>
      defineConfig({
        name: 'test',
        runtime: { name: 'mock', createStream: async function* () {} },
        tools: [
          defineTool({ name: 'ping', description: 'A', handler: async () => 'a' }),
          defineTool({ name: 'ping', description: 'B', handler: async () => 'b' }),
        ],
      })
    ).toThrow(/Duplicate tool name "ping"/)
  })

  it('allows unique tool names', () => {
    expect(() =>
      defineConfig({
        name: 'test',
        runtime: { name: 'mock', createStream: async function* () {} },
        tools: [
          defineTool({ name: 'ping', description: 'A', handler: async () => 'a' }),
          defineTool({ name: 'pong', description: 'B', handler: async () => 'b' }),
        ],
      })
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/core/src/__tests__/config.test.ts`
Expected: FAIL (no validation yet)

- [ ] **Step 3: Add validation to defineConfig**

In `packages/core/src/config.ts`, add before the return statement:

```typescript
// Validate tool name uniqueness
const toolNames = new Set<string>()
for (const tool of tools) {
  if (toolNames.has(tool.name)) {
    throw new Error(`Duplicate tool name "${tool.name}" — tool names must be unique across all tools.`)
  }
  toolNames.add(tool.name)
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/core/src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/src/__tests__/config.test.ts
git commit -m "feat(core): validate tool name uniqueness in defineConfig"
```

---

## Chunk 2: Claude Runtime — Inline Tool Support

### Task 4: buildToolConfig() with Inline + MCP Split

**Files:**
- Modify: `packages/runtime-claude/src/runtime.ts:40-43, 131-137`
- Create or modify: `packages/runtime-claude/src/__tests__/runtime.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/runtime-claude/src/__tests__/buildToolConfig.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildToolConfig } from '../runtime.js'
import { defineTool } from '@sena-ai/core'
import { z } from 'zod'
import type { McpToolPort } from '@sena-ai/core'

const runtimeInfo = { name: 'claude' }

describe('buildToolConfig', () => {
  it('separates inline and MCP tools', () => {
    const inline = defineTool({
      name: 'ping',
      description: 'Ping',
      handler: async () => 'pong',
    })
    const mcp: McpToolPort = {
      name: 'posthog',
      type: 'mcp-http',
      toMcpConfig: () => ({ url: 'https://example.com/mcp' }),
    }

    const config = buildToolConfig([inline, mcp], runtimeInfo)
    expect(config.nativeTools).toHaveLength(1)
    expect(config.nativeTools[0].name).toBe('ping')
    expect(config.mcpServers).toHaveProperty('posthog')
    expect(config.allowedTools).toContain('ping')
    expect(config.allowedTools).toContain('mcp__posthog__*')
  })

  it('handles empty tools array', () => {
    const config = buildToolConfig([], runtimeInfo)
    expect(config.nativeTools).toHaveLength(0)
    expect(Object.keys(config.mcpServers)).toHaveLength(0)
    expect(config.allowedTools).toHaveLength(0)
  })

  it('inline tool handler returns string → wrapped content', async () => {
    const inline = defineTool({
      name: 'echo',
      description: 'Echo',
      params: { msg: z.string() },
      handler: async ({ msg }) => msg,
    })
    const config = buildToolConfig([inline], runtimeInfo)
    const result = await config.nativeTools[0].handler({ msg: 'hello' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] })
  })

  it('inline tool handler returns object → JSON stringified', async () => {
    const inline = defineTool({
      name: 'data',
      description: 'Data',
      handler: async () => ({ key: 'value' }),
    })
    const config = buildToolConfig([inline], runtimeInfo)
    const result = await config.nativeTools[0].handler({})
    expect(result).toEqual({ content: [{ type: 'text', text: '{"key":"value"}' }] })
  })

  it('inline tool handler error → isError true', async () => {
    const inline = defineTool({
      name: 'fail',
      description: 'Fail',
      handler: async () => { throw new Error('boom') },
    })
    const config = buildToolConfig([inline], runtimeInfo)
    const result = await config.nativeTools[0].handler({})
    expect(result.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-claude/src/__tests__/buildToolConfig.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement buildToolConfig**

In `packages/runtime-claude/src/runtime.ts`:

1. Import types: `import type { ToolPort, McpToolPort, InlineToolPort, RuntimeInfo, McpConfig } from '@sena-ai/core'`
2. Import: `import { isBrandedToolResult } from '@sena-ai/core'`
3. Replace `buildMcpServers` (lines 131-137) with `buildToolConfig`:

```typescript
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
```

4. Update the call site (around line 40-43) to use `buildToolConfig`:

```typescript
const { mcpServers, nativeTools, allowedTools } = buildToolConfig(tools, runtimeInfo)
```

5. Pass `nativeTools` to SDK options (check Claude Agent SDK docs for exact API).

- [ ] **Step 4: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-claude/src/__tests__/buildToolConfig.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`

- [ ] **Step 6: Run all tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/runtime-claude/
git commit -m "feat(runtime-claude): buildToolConfig with inline tool support"
```

---

## Chunk 3: Codex Runtime — Tool Support (StreamableHTTP Bridge)

### Task 5: startInlineMcpHttpServer()

**Files:**
- Create: `packages/runtime-codex/src/inline-mcp-server.ts`
- Create: `packages/runtime-codex/src/__tests__/inline-mcp-server.test.ts`
- Modify: `packages/runtime-codex/package.json` (add MCP deps)

- [ ] **Step 1: Install dependencies**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm --filter @sena-ai/runtime-codex add @modelcontextprotocol/sdk`

Note: Check if `@modelcontextprotocol/server` and `@modelcontextprotocol/node` are separate packages or part of `@modelcontextprotocol/sdk`. Install whichever provides `McpServer` and `NodeStreamableHTTPServerTransport`.

- [ ] **Step 2: Write failing tests**

Create `packages/runtime-codex/src/__tests__/inline-mcp-server.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { startInlineMcpHttpServer } from '../inline-mcp-server.js'
import { defineTool } from '@sena-ai/core'
import { z } from 'zod'

describe('startInlineMcpHttpServer', () => {
  let bridge: Awaited<ReturnType<typeof startInlineMcpHttpServer>>

  afterEach(async () => {
    if (bridge) await bridge.close()
  })

  it('returns null for empty tools', async () => {
    bridge = await startInlineMcpHttpServer([])
    expect(bridge).toBeNull()
  })

  it('starts HTTP server on random port', async () => {
    const tool = defineTool({
      name: 'ping',
      description: 'Ping',
      handler: async () => 'pong',
    })
    bridge = await startInlineMcpHttpServer([tool])
    expect(bridge).not.toBeNull()
    expect(bridge!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('responds to MCP tool call via HTTP', async () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo',
      params: { msg: z.string() },
      handler: async ({ msg }) => `echo: ${msg}`,
    })
    bridge = await startInlineMcpHttpServer([tool])

    // Use MCP client to connect and call the tool
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')

    const client = new Client({ name: 'test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(bridge!.url))
    await client.connect(transport)

    const result = await client.callTool({ name: 'echo', arguments: { msg: 'hello' } })
    expect(result.content).toEqual([{ type: 'text', text: 'echo: hello' }])

    await client.close()
  })

  it('closes HTTP server cleanly', async () => {
    const tool = defineTool({
      name: 'ping',
      description: 'Ping',
      handler: async () => 'pong',
    })
    bridge = await startInlineMcpHttpServer([tool])
    await bridge!.close()

    // Verify server is closed — fetch should fail
    try {
      await fetch(bridge!.url, { method: 'POST' })
      expect.fail('Should have thrown')
    } catch {
      // Expected: connection refused
    }
    bridge = null // prevent double-close in afterEach
  })
})
```

- [ ] **Step 3: Run tests to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-codex/src/__tests__/inline-mcp-server.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement inline-mcp-server.ts**

Create `packages/runtime-codex/src/inline-mcp-server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { InlineToolPort } from '@sena-ai/core'
import { isBrandedToolResult } from '@sena-ai/core'

export type InlineMcpBridge = {
  url: string
  close: () => Promise<void>
}

export async function startInlineMcpHttpServer(
  inlineTools: InlineToolPort[],
): Promise<InlineMcpBridge | null> {
  if (inlineTools.length === 0) return null

  const mcpServer = new McpServer({ name: 'sena-inline-tools', version: '1.0.0' })

  for (const tool of inlineTools) {
    mcpServer.tool(
      tool.name,
      tool.inline.description,
      tool.inline.inputSchema.properties ?? {},
      async (params: any) => {
        const raw = await tool.inline.handler(params)
        return normalizeToMcpResult(raw)
      },
    )
  }

  // Import transport dynamically to handle package resolution
  const { NodeStreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  )

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/mcp' && req.method === 'POST') {
      const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      await mcpServer.connect(transport)
      const body = await parseBody(req)
      await transport.handleRequest(req, res, body)
    } else {
      res.writeHead(404).end()
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as any).port

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  }
}

function normalizeToMcpResult(raw: unknown): { content: Array<{ type: string; text: string }> } {
  if (isBrandedToolResult(raw)) {
    return { content: raw.content as any }
  }
  if (typeof raw === 'string') {
    return { content: [{ type: 'text', text: raw }] }
  }
  return { content: [{ type: 'text', text: JSON.stringify(raw) }] }
}

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-codex/src/__tests__/inline-mcp-server.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-codex/
git commit -m "feat(runtime-codex): startInlineMcpHttpServer for inline tool bridge"
```

---

### Task 6: Codex Runtime Tool Integration

**Files:**
- Modify: `packages/runtime-codex/src/runtime.ts`
- Modify: `packages/runtime-codex/src/client.ts`

- [ ] **Step 1: Write failing test for -c flag generation**

Add to existing test file or create `packages/runtime-codex/src/__tests__/configOverrides.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildCodexConfigOverrides } from '../runtime.js'
import { defineTool } from '@sena-ai/core'
import type { McpToolPort } from '@sena-ai/core'

describe('buildCodexConfigOverrides', () => {
  it('generates -c flag for inline bridge URL', () => {
    const overrides = buildCodexConfigOverrides(
      'http://127.0.0.1:12345/mcp',
      [],
    )
    expect(overrides).toContain('mcp_servers.__inline__.url="http://127.0.0.1:12345/mcp"')
  })

  it('generates -c flag for HTTP MCP tool', () => {
    const mcp: McpToolPort = {
      name: 'posthog',
      type: 'mcp-http',
      toMcpConfig: () => ({ url: 'https://mcp.posthog.com/mcp' }),
    }
    const overrides = buildCodexConfigOverrides(null, [mcp])
    expect(overrides).toContain('mcp_servers.posthog.url="https://mcp.posthog.com/mcp"')
  })

  it('generates -c flag for stdio MCP tool', () => {
    const mcp: McpToolPort = {
      name: 'local',
      type: 'mcp-stdio',
      toMcpConfig: () => ({ command: ['node', 'server.js'] }),
    }
    const overrides = buildCodexConfigOverrides(null, [mcp])
    expect(overrides[0]).toMatch(/mcp_servers\.local\.command/)
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-codex/src/__tests__/configOverrides.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tool handling in runtime.ts**

1. Add `buildCodexConfigOverrides` function (exported for testing):

```typescript
export function buildCodexConfigOverrides(
  inlineBridgeUrl: string | null,
  mcpTools: McpToolPort[],
): string[] {
  const overrides: string[] = []

  if (inlineBridgeUrl) {
    overrides.push(`mcp_servers.__inline__.url="${inlineBridgeUrl}"`)
  }

  for (const tool of mcpTools) {
    const config = tool.toMcpConfig({ name: 'codex' }) as any
    if (config.url) {
      overrides.push(`mcp_servers.${tool.name}.url="${config.url}"`)
    } else if (config.command) {
      const cmd = Array.isArray(config.command) ? config.command : [config.command, ...(config.args ?? [])]
      overrides.push(`mcp_servers.${tool.name}.command=${JSON.stringify(cmd)}`)
    }
  }

  return overrides
}
```

2. Update `createStream()` to split tools and start bridge:

```typescript
import { startInlineMcpHttpServer, type InlineMcpBridge } from './inline-mcp-server.js'
import type { InlineToolPort, McpToolPort } from '@sena-ai/core'

// Inside createStream:
const inlineTools = tools.filter((t): t is InlineToolPort => t.type === 'inline')
const mcpTools = tools.filter((t): t is McpToolPort => t.type !== 'inline')

const inlineBridge = await startInlineMcpHttpServer(inlineTools)

const configOverrides = buildCodexConfigOverrides(
  inlineBridge?.url ?? null,
  mcpTools,
)

try {
  // Pass configOverrides to client.spawn()
  // ... existing logic ...
} finally {
  if (inlineBridge) await inlineBridge.close()
}
```

3. Update `client.ts` to accept config overrides in spawn:

```typescript
spawn(configOverrides?: string[]) {
  const args = ['app-server']
  if (configOverrides?.length) {
    for (const c of configOverrides) {
      args.push('-c', c)
    }
  }
  this.child = spawn(this.codexBin, args, { stdio: ['pipe', 'pipe', 'inherit'] })
  // ...
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/runtime-codex/`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/runtime-codex/
git commit -m "feat(runtime-codex): tool support via StreamableHTTP bridge + -c flags"
```

---

## Chunk 4: tools-slack Conversion & Cleanup

### Task 7: Convert tools-slack to Inline

**Files:**
- Modify: `packages/tools-slack/src/slackTools.ts`
- Modify: `packages/tools-slack/src/index.ts`
- Modify: `packages/tools-slack/src/__tests__/slackTools.test.ts`
- Modify: `packages/tools-slack/package.json`
- Delete: `packages/tools-slack/src/mcp-server.ts`
- Delete: `packages/tools-slack/src/__tests__/mcp-protocol.test.ts`

- [ ] **Step 1: Write new tests first**

Replace `packages/tools-slack/src/__tests__/slackTools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { slackTools } from '../slackTools.js'

describe('slackTools', () => {
  it('returns an array of ToolPorts', () => {
    const tools = slackTools({ botToken: 'xoxb-test' })
    expect(Array.isArray(tools)).toBe(true)
    expect(tools.length).toBeGreaterThan(0)
  })

  it('all tools are inline type', () => {
    const tools = slackTools({ botToken: 'xoxb-test' })
    for (const tool of tools) {
      expect(tool.type).toBe('inline')
    }
  })

  it('includes expected tool names', () => {
    const tools = slackTools({ botToken: 'xoxb-test' })
    const names = tools.map(t => t.name)
    expect(names).toContain('slack_get_messages')
    expect(names).toContain('slack_post_message')
    expect(names).toContain('slack_list_channels')
    expect(names).toContain('slack_upload_file')
    expect(names).toContain('slack_download_file')
  })

  it('each tool has description and handler', () => {
    const tools = slackTools({ botToken: 'xoxb-test' })
    for (const tool of tools) {
      if (tool.type === 'inline') {
        expect(tool.inline.description).toBeTruthy()
        expect(typeof tool.inline.handler).toBe('function')
      }
    }
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/tools-slack/src/__tests__/slackTools.test.ts`
Expected: FAIL (returns single ToolPort, not array)

- [ ] **Step 3: Rewrite slackTools.ts using defineTool**

Replace `packages/tools-slack/src/slackTools.ts` with inline tool definitions using `defineTool` from `@sena-ai/core`. Port each tool from `mcp-server.ts`:

```typescript
import { defineTool } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { z } from 'zod'
import type { ToolPort } from '@sena-ai/core'

export type SlackToolsOptions = {
  botToken: string
}

export function slackTools(options: SlackToolsOptions): ToolPort[] {
  const slack = new WebClient(options.botToken)

  return [
    defineTool({
      name: 'slack_get_messages',
      description: 'Get messages from a Slack channel or thread',
      params: {
        channelId: z.string(),
        threadTs: z.string().optional(),
        limit: z.number().optional(),
      },
      handler: async ({ channelId, threadTs, limit }) => {
        const result = threadTs
          ? await slack.conversations.replies({ channel: channelId, ts: threadTs, limit: limit ?? 20 })
          : await slack.conversations.history({ channel: channelId, limit: limit ?? 20 })
        return (result.messages ?? []).map(m => ({
          user: m.user, text: m.text, ts: m.ts, thread_ts: m.thread_ts,
        }))
      },
    }),

    defineTool({
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel or thread',
      params: {
        channelId: z.string(),
        text: z.string(),
        threadTs: z.string().optional(),
      },
      handler: async ({ channelId, text, threadTs }) => {
        const result = await slack.chat.postMessage({ channel: channelId, text, thread_ts: threadTs })
        return { ok: result.ok, ts: result.ts }
      },
    }),

    defineTool({
      name: 'slack_list_channels',
      description: 'List accessible Slack channels',
      params: {
        limit: z.number().optional(),
        types: z.string().optional(),
      },
      handler: async ({ limit, types }) => {
        const result = await slack.conversations.list({
          limit: limit ?? 100,
          types: types ?? 'public_channel,private_channel',
        })
        return (result.channels ?? []).map(c => ({
          id: c.id, name: c.name, is_private: c.is_private, num_members: c.num_members,
        }))
      },
    }),

    defineTool({
      name: 'slack_upload_file',
      description: 'Upload a file to a Slack channel',
      params: {
        channelId: z.string(),
        content: z.string(),
        filename: z.string(),
        title: z.string().optional(),
      },
      handler: async ({ channelId, content, filename, title }) => {
        const result = await slack.filesUploadV2({
          channel_id: channelId,
          content,
          filename,
          title: title ?? filename,
        })
        return { ok: true, file_id: (result as any).files?.[0]?.id }
      },
    }),

    defineTool({
      name: 'slack_download_file',
      description: 'Download a file from Slack by file ID',
      params: { fileId: z.string() },
      handler: async ({ fileId }) => {
        const info = await slack.files.info({ file: fileId })
        const file = info.file
        if (!file?.url_private) throw new Error('File URL not available')

        const response = await fetch(file.url_private, {
          headers: { Authorization: `Bearer ${options.botToken}` },
        })
        const buffer = await response.arrayBuffer()
        const content = Buffer.from(buffer).toString('utf-8').slice(0, 50_000)

        return {
          name: file.name,
          mimetype: file.mimetype,
          size: file.size,
          content,
        }
      },
    }),
  ]
}
```

- [ ] **Step 4: Update package.json — remove MCP SDK dep, ensure @sena-ai/core is there**

In `packages/tools-slack/package.json`:
- Remove `@modelcontextprotocol/sdk` from dependencies
- Keep `@slack/web-api` and `zod`
- Remove `bin` entry (`sena-slack-mcp`)

- [ ] **Step 5: Delete mcp-server.ts and its test**

```bash
rm packages/tools-slack/src/mcp-server.ts
rm packages/tools-slack/src/__tests__/mcp-protocol.test.ts
```

- [ ] **Step 6: Update index.ts**

Ensure `packages/tools-slack/src/index.ts` exports correctly.

- [ ] **Step 7: Run tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test -- packages/tools-slack/`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`

- [ ] **Step 9: Commit**

```bash
git add packages/tools-slack/
git commit -m "feat(tools-slack): convert to inline defineTool, remove MCP server"
```

---

### Task 8: Delete tools-obsidian Package

**Files:**
- Delete: `packages/tools-obsidian/` (entire directory)
- Modify: `tsconfig.json` (remove project reference)
- Modify: `pnpm-workspace.yaml` (if needed)

- [ ] **Step 1: Remove from tsconfig references**

In root `tsconfig.json`, remove `{ "path": "packages/tools-obsidian" }` from references.

- [ ] **Step 2: Delete the package**

```bash
rm -rf packages/tools-obsidian/
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`

- [ ] **Step 4: Run all tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete tools-obsidian package (unused)"
```

---

## Chunk 5: Final Integration & Verification

### Task 9: Full Integration Test

**Files:**
- All packages

- [ ] **Step 1: Typecheck full project**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `cd /Users/agent/workspace/repos/sena-v2 && pnpm test`
Expected: All pass

- [ ] **Step 3: Verify no stale references**

Search for any remaining references to `'builtin'` type, `tools-obsidian`, or old `toMcpConfig` calls on inline tools:

```bash
cd /Users/agent/workspace/repos/sena-v2
grep -r "builtin" packages/ --include="*.ts" -l
grep -r "tools-obsidian" packages/ --include="*.ts" -l
grep -r "tools-obsidian" package.json tsconfig.json pnpm-workspace.yaml
```

- [ ] **Step 4: Commit any fixes**

- [ ] **Step 5: Final commit & push**

```bash
git push origin v2
```
