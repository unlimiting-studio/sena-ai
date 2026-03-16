# Inline Tool API Design

> `defineTool()` — 선언적 인라인 도구 정의 API로 보일러플레이트를 최소화한다.

## 배경

v1에서 모든 도구가 MCP 서버(stdio)로 구현된 이유는 Codex 런타임이 MCP만 지원하기 때문이었다. 이로 인해 단순한 API 호출 하나를 도구로 만들려면 별도 패키지 + MCP 서버 스켈레톤 + ToolPort 팩토리가 필요했다.

## 목표

- 도구 하나를 만드는 데 필요한 코드를 최소화한다.
- 기존 MCP 도구(`mcpServer()`)와 공존한다.
- Claude/Codex 양쪽 런타임을 모두 지원한다.
- 기존 MCP 방식 도구(`tools-slack`)를 인라인으로 전환한다.

## 비목표

- MCP 프로토콜 자체를 대체하지 않는다. 외부 서비스 연결은 `mcpServer()`를 계속 사용한다.
- 도구 간 의존성/파이프라인은 다루지 않는다.

---

## 1. 사용자 API

### 1.1 `defineTool(options): ToolPort`

```ts
import { defineTool, toolResult } from '@sena-ai/core'
import { z } from 'zod'

defineTool({
  name: 'weather',
  description: 'Get current weather for a city',
  params: { city: z.string() },
  handler: async ({ city }) => `${city}: 맑음 22°C`,
})
```

#### 옵션

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `name` | `string` | ✅ | 도구 이름 (LLM에 노출) |
| `description` | `string` | ✅ | 도구 설명 (LLM에 노출) |
| `params` | `Record<string, ZodSchema>` | ❌ | 파라미터 스키마. 없으면 파라미터 없는 도구. |
| `handler` | `(params) => string \| object \| BrandedToolResult \| Promise<...>` | ✅ | 도구 실행 함수. 동기/비동기 모두 허용. |

#### 반환 타입: `ToolPort`

`defineTool()`은 기존과 동일한 `ToolPort`를 반환하므로 `tools` 배열에 그대로 들어간다.

#### Zod → JSON Schema 변환

`params`의 `Record<string, ZodSchema>`는 `zod-to-json-schema` 라이브러리로 JSON Schema `object` 타입으로 변환한다:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema'

// params: { city: z.string(), days: z.number().optional() }
// →
// {
//   type: 'object',
//   properties: {
//     city: { type: 'string' },
//     days: { type: 'number' }
//   },
//   required: ['city']
// }
function paramsToJsonSchema(params: Record<string, ZodSchema>): JsonSchema {
  const shape: Record<string, ZodSchema> = params
  const schema = z.object(shape)
  return zodToJsonSchema(schema, { target: 'jsonSchema7' })
}
```

`params`가 없으면 빈 object 스키마(`{ type: 'object', properties: {} }`)를 생성한다.

### 1.2 핸들러 반환값

| 반환 타입 | 처리 |
|----------|------|
| `string` | 텍스트로 래핑하여 LLM에 전달 |
| `object` (일반) | `JSON.stringify` 후 텍스트로 전달 |
| `BrandedToolResult` | 멀티모달 콘텐츠 그대로 전달 |

일반 객체와 멀티모달 결과를 명확히 구분하기 위해 `toolResult()` 헬퍼를 사용한다:

```ts
import { toolResult } from '@sena-ai/core'

// 멀티모달 반환
const imageData = fs.readFileSync('chart.png').toString('base64')
handler: async ({ query }) => toolResult([
  { type: 'text', text: '이미지 결과입니다' },
  { type: 'image', data: imageData, mimeType: 'image/png' },
])
```

`toolResult()`는 내부적으로 브랜드 심볼을 부착하여 일반 객체와 구분한다:

```ts
const TOOL_RESULT = Symbol('ToolResult')

type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

type BrandedToolResult = {
  [TOOL_RESULT]: true
  content: ToolContent[]
}

function toolResult(content: ToolContent[]): BrandedToolResult {
  return { [TOOL_RESULT]: true, content }
}

function isBrandedToolResult(value: unknown): value is BrandedToolResult {
  return typeof value === 'object' && value !== null && TOOL_RESULT in value
}
```

`ToolContent`는 MCP 프로토콜의 콘텐츠 형식을 따른다. 각 런타임 어댑터가 자신의 SDK 형식으로 변환한다 (섹션 3 참고).

### 1.3 에러 처리

- 핸들러가 `throw` → 프레임워크가 catch → `isError: true` + 에러 메시지를 LLM에 반환.
- 별도의 에러 래핑이나 try-catch 불필요.

### 1.4 이름 충돌 방지

`defineConfig()` 내에서 `tools` 배열을 resolve할 때, 모든 `ToolPort`의 `name`이 고유한지 검증한다. 중복 시 시작 단계에서 에러를 throw한다:

```
Error: Duplicate tool name "slack_get_messages" — tool names must be unique across all tools.
```

### 1.5 사용 예시 (`sena.config.ts`)

```ts
import { defineConfig, defineTool, env } from '@sena-ai/core'
import { slackTools } from '@sena-ai/tools-slack'
import { mcpServer } from '@sena-ai/tools'

export default defineConfig({
  name: 'sena',
  runtime: claudeRuntime({ model: 'claude-sonnet-4-5' }),
  tools: [
    // 인라인 도구
    defineTool({
      name: 'weather',
      description: 'Get current weather',
      params: { city: z.string() },
      handler: async ({ city }) => `${city}: 맑음`,
    }),
    defineTool({
      name: 'ping',
      description: 'Health check',
      handler: async () => 'pong',
    }),

    // 패키지 도구 (내부적으로 defineTool 사용, ToolPort[] 반환)
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),

    // 외부 MCP 서버
    mcpServer({ name: 'posthog', url: 'https://mcp.posthog.com/mcp' }),
  ],
})
```

---

## 2. ToolPort 타입 확장

### 2.1 Discriminated Union 방식

기존 `ToolPort`를 단일 타입에서 discriminated union으로 변경한다:

```ts
type McpToolPort = {
  name: string
  type: 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}

// 참고: 기존 'builtin' 타입은 사용되지 않으므로 제거한다.
// 현재 코드베이스에 'builtin' 타입을 가진 도구가 존재하지 않음.

type InlineToolPort = {
  name: string
  type: 'inline'
  inline: InlineToolDef
}

type InlineToolDef = {
  description: string
  params?: Record<string, ZodSchema>
  inputSchema: JsonSchema  // paramsToJsonSchema()로 미리 변환
  handler: (params: any) => string | object | BrandedToolResult | Promise<string | object | BrandedToolResult>
}

type ToolPort = McpToolPort | InlineToolPort
```

`InlineToolPort`에는 `toMcpConfig()`가 없다. 각 런타임이 `type`으로 분기하므로 인라인 도구에서 `toMcpConfig()`를 호출할 일이 없다.

### 2.2 `defineTool()` 구현

```ts
function defineTool(options: DefineToolOptions): InlineToolPort {
  const inputSchema = options.params
    ? paramsToJsonSchema(options.params)
    : { type: 'object', properties: {} }

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
```

### 2.3 파일 위치

`defineTool()`, `toolResult()`, `isBrandedToolResult()`, `paramsToJsonSchema()`는 `@sena-ai/core`의 새 파일 `packages/core/src/tool.ts`에 구현한다. `packages/core/src/index.ts`에서 re-export.

---

## 3. 런타임 어댑터

### 3.1 Claude 런타임

기존 `buildMcpServers()`를 `buildToolConfig()`로 확장한다:

```ts
function buildToolConfig(tools: ToolPort[], runtimeInfo: RuntimeInfo) {
  const mcpServers: Record<string, McpConfig> = {}
  const nativeTools: NativeTool[] = []
  const allowedTools: string[] = []

  for (const tool of tools) {
    if (tool.type === 'inline') {
      // SDK 네이티브 tool로 등록
      nativeTools.push({
        name: tool.name,
        description: tool.inline.description,
        input_schema: tool.inline.inputSchema,
        handler: wrapHandler(tool.inline.handler),
      })
      // Claude Agent SDK는 네이티브 tool을 bare name으로 참조한다 (mcp__ 접두사 없음).
      // 구현 시 SDK 문서에서 allowedTools 패턴을 재확인할 것.
      allowedTools.push(tool.name)
    } else {
      // MCP 서버로 등록
      mcpServers[tool.name] = tool.toMcpConfig(runtimeInfo)
      allowedTools.push(`mcp__${tool.name}__*`)
    }
  }

  return { mcpServers, nativeTools, allowedTools }
}
```

`wrapHandler()`는 핸들러 반환값을 Claude SDK 형식으로 변환한다:

```ts
function wrapHandler(handler: InlineToolDef['handler']) {
  return async (params: any) => {
    const raw = await handler(params)
    if (isBrandedToolResult(raw)) {
      // ToolContent → Claude SDK content block 변환
      return {
        content: raw.content.map(c => {
          if (c.type === 'text') return { type: 'text', text: c.text }
          if (c.type === 'image') return {
            type: 'image',
            source: { type: 'base64', media_type: c.mimeType, data: c.data },
          }
          throw new Error(`Unknown ToolContent type: ${(c as any).type}`)
        }),
      }
    }
    if (typeof raw === 'string') return { content: [{ type: 'text', text: raw }] }
    return { content: [{ type: 'text', text: JSON.stringify(raw) }] }
  }
}
```

### 3.2 Codex 런타임

현재 Codex 런타임은 `tools`를 전혀 사용하지 않는다 (MCP 도구 포함). 이 스펙에서 Codex에 **인라인 도구와 MCP 도구 모두**에 대한 도구 지원을 추가한다.

#### 인라인 도구 → localhost StreamableHTTP MCP 서버

Codex app server는 MCP 서버 연결 시 **StreamableHTTP** (`url` 설정)을 네이티브 지원한다. 인라인 도구를 같은 Worker 프로세스 내에서 HTTP MCP 서버로 노출하고, Codex에 `-c` 플래그로 URL을 전달한다.

```
Worker 프로세스 (단일)
  ├─ HTTP 서버 (127.0.0.1:PORT/mcp)
  │    └─ StreamableHTTPServerTransport
  │         └─ McpServer (인라인 도구 핸들러 직접 호출)
  │
  └─ Codex app server (stdio)
       └─ -c 'mcp_servers.__inline__.url="http://127.0.0.1:PORT/mcp"'
```

핸들러가 같은 프로세스에서 실행되므로 child process, IPC, 직렬화가 모두 불필요하다.

구현:

```ts
import { McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { createServer } from 'node:http'

// Worker 프로세스 내에서 인라인 도구를 MCP 서버로 노출
async function startInlineMcpHttpServer(
  inlineTools: InlineToolPort[]
): Promise<{ url: string; close: () => Promise<void> }> {
  if (inlineTools.length === 0) return null

  const mcpServer = new McpServer({ name: 'sena-inline-tools', version: '1.0.0' })

  // 각 인라인 도구를 MCP server.tool()로 등록
  for (const tool of inlineTools) {
    mcpServer.tool(
      tool.name,
      tool.inline.description,
      tool.inline.inputSchema.properties ?? {},
      async (params) => {
        const raw = await tool.inline.handler(params)
        return normalizeToMcpResult(raw)
      }
    )
  }

  // HTTP 서버 시작 (127.0.0.1, 랜덤 포트)
  const httpServer = createServer()
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  })

  httpServer.on('request', async (req, res) => {
    if (req.url === '/mcp' && req.method === 'POST') {
      await mcpServer.connect(transport)
      await transport.handleRequest(req, res, await parseBody(req))
    } else {
      res.writeHead(404).end()
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = (httpServer.address() as any).port

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise((resolve) => httpServer.close(resolve)),
  }
}

// 핸들러 반환값 → MCP content 변환
function normalizeToMcpResult(raw: unknown) {
  if (isBrandedToolResult(raw)) return { content: raw.content }
  if (typeof raw === 'string') return { content: [{ type: 'text', text: raw }] }
  return { content: [{ type: 'text', text: JSON.stringify(raw) }] }
}
```

#### MCP 도구 → Codex `-c` 플래그

기존 MCP 도구(`McpToolPort`)도 Codex에 전달한다. `toMcpConfig()`의 결과를 `-c` 플래그로 변환:

```ts
// stdio MCP 도구 → Codex -c 플래그
// -c 'mcp_servers.slack.command=["node", "/path/to/server.js"]'

// http MCP 도구 → Codex -c 플래그
// -c 'mcp_servers.posthog.url="https://mcp.posthog.com/mcp"'
```

#### `createStream()` 통합

```ts
async *createStream(streamOptions: RuntimeStreamOptions) {
  const { tools, ...rest } = streamOptions

  // 인라인/MCP 분리
  const inlineTools = tools.filter((t): t is InlineToolPort => t.type === 'inline')
  const mcpTools = tools.filter((t): t is McpToolPort => t.type !== 'inline')

  // 인라인 → localhost HTTP MCP 서버
  const inlineBridge = await startInlineMcpHttpServer(inlineTools)

  // Codex app server spawn 시 -c 플래그 구성
  const configOverrides: string[] = []

  // 인라인 도구 브릿지 URL
  if (inlineBridge) {
    configOverrides.push(`mcp_servers.__inline__.url="${inlineBridge.url}"`)
  }

  // 기존 MCP 도구
  for (const t of mcpTools) {
    const config = t.toMcpConfig({ name: 'codex' })
    if (config.url) {
      configOverrides.push(`mcp_servers.${t.name}.url="${config.url}"`)
    } else if (config.command) {
      configOverrides.push(`mcp_servers.${t.name}.command=${JSON.stringify(config.command)}`)
    }
  }

  try {
    // Codex app server에 -c 플래그로 MCP 설정 전달
    // spawn('codex', ['app-server', ...configOverrides.flatMap(c => ['-c', c])])
    // ...기존 Codex 프로토콜 로직 + yield events
  } finally {
    // HTTP 서버 정리
    if (inlineBridge) await inlineBridge.close()
  }
}
```

---

## 4. 마이그레이션

### 변경 필요

| 패키지 | 변경 내용 |
|--------|----------|
| `@sena-ai/core` | `ToolPort` discriminated union으로 변경, `defineTool()`, `toolResult()`, `paramsToJsonSchema()` 추가, 이름 충돌 검증 추가 |
| `@sena-ai/runtime-claude` | `buildMcpServers()` → `buildToolConfig()`로 확장, 인라인 도구 네이티브 등록, `allowedTools` 패턴 분기 |
| `@sena-ai/runtime-codex` | **도구 지원 전체 추가** (현재 zero tool support): 인라인 도구 → localhost StreamableHTTP MCP 서버로 노출, MCP 도구 → `-c` 플래그로 Codex에 전달. `createStream()`에서 tools 처리 로직 신규 작성. |
| `@sena-ai/tools-slack` | MCP 서버 방식 → `defineTool` 인라인으로 전환. `mcp-server.ts` 제거. `slackTools()` 반환 타입 `ToolPort` → `ToolPort[]` (breaking change, 아래 참고). |

### `slackTools()` breaking change

반환 타입이 `ToolPort` (단일) → `ToolPort[]` (배열)로 변경된다. 사용처에서 spread 연산자를 추가해야 한다:

```ts
// Before
tools: [slackTools({ botToken: '...' })]

// After
tools: [...slackTools({ botToken: '...' })]
```

현재 이 패키지의 유일한 소비자는 sena 자체 설정 파일이므로 외부 호환성 문제는 없다.

### 삭제

| 패키지 | 이유 |
|--------|------|
| `@sena-ai/tools-obsidian` | 사용하지 않음 |

### 변경 없음

| 패키지 | 이유 |
|--------|------|
| `@sena-ai/tools` | 외부 MCP 서버 연결용 `mcpServer()` 여전히 필요 |
| `@sena-ai/connector-slack` | 도구와 무관 |
| `@sena-ai/engine` | `ToolPort[]`를 그대로 전달하는 구조 (mixed array를 받지만 분기하지 않음) |
| `@sena-ai/worker` | 동일 |

---

## 5. 테스트 전략

### 단위 테스트

- `defineTool()` → 올바른 `InlineToolPort` 생성 확인 (`type: 'inline'`, `inline` 필드 존재)
- `paramsToJsonSchema()` → Zod 스키마 → JSON Schema 변환 (required/optional 구분 포함)
- 핸들러 반환값 변환: `string`, `object`, `toolResult()` 각각 올바르게 변환
- 에러 처리: `throw` 시 `isError: true` 전파
- `toolResult()` 브랜드 심볼: `isBrandedToolResult()` 검증
- 이름 충돌 검증: 중복 시 에러 throw

### 런타임 어댑터 테스트

- Claude: 인라인 도구가 네이티브 tool로 변환되는지 (input_schema 포함)
- Claude: 인라인 + MCP 도구 혼합 시 `allowedTools`에 올바른 패턴 생성
- Claude: `wrapHandler()`가 `ToolContent` → Claude SDK content block 변환 검증
- Codex: `startInlineMcpHttpServer()`가 localhost HTTP MCP 서버 시작, 포트 바인딩 확인
- Codex: HTTP MCP 서버로 도구 호출 → 핸들러 실행 → MCP content 반환 검증
- Codex: `createStream()` cleanup 시 HTTP 서버 정상 종료 확인
- Codex: `-c` 플래그로 MCP 도구 설정이 올바르게 생성되는지 검증

### 핸들러 직접 테스트

인라인 도구의 핸들러는 순수 함수이므로 MCP 서버 없이 직접 호출하여 테스트 가능:

```ts
const tool = defineTool({
  name: 'ping',
  description: 'Health check',
  handler: async () => 'pong',
})
const result = await tool.inline.handler({})
expect(result).toBe('pong')
```

---

## 6. 의존성 추가

| 패키지 | 새 의존성 | 용도 |
|--------|----------|------|
| `@sena-ai/core` | `zod-to-json-schema` | params → JSON Schema 변환 |
| `@sena-ai/runtime-codex` | `@modelcontextprotocol/server`, `@modelcontextprotocol/node` | 인라인 도구를 StreamableHTTP MCP 서버로 노출 |
