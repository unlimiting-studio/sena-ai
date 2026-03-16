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
| `handler` | `(params) => Promise<string \| object \| BrandedToolResult>` | ✅ | 도구 실행 함수 |

#### 반환 타입: `ToolPort`

`defineTool()`은 기존과 동일한 `ToolPort`를 반환하므로 `tools` 배열에 그대로 들어간다.

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
handler: async ({ query }) => toolResult([
  { type: 'text', text: '이미지 결과입니다' },
  { type: 'image', data: base64, mimeType: 'image/png' },
])
```

`toolResult()`는 내부적으로 브랜드 심볼을 부착하여 일반 객체와 구분한다:

```ts
const TOOL_RESULT = Symbol('ToolResult')

type BrandedToolResult = {
  [TOOL_RESULT]: true
  content: ToolContent[]
}

function toolResult(content: ToolContent[]): BrandedToolResult {
  return { [TOOL_RESULT]: true, content }
}
```

### 1.3 에러 처리

- 핸들러가 `throw` → 프레임워크가 catch → `isError: true` + 에러 메시지를 LLM에 반환.
- 별도의 에러 래핑이나 try-catch 불필요.

### 1.4 사용 예시 (`sena.config.ts`)

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

    // 패키지 도구 (내부적으로 defineTool 사용)
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),

    // 외부 MCP 서버
    mcpServer({ name: 'posthog', url: 'https://mcp.posthog.com/mcp' }),
  ],
})
```

---

## 2. ToolPort 타입 확장

```ts
// 기존
type ToolPort = {
  name: string
  type: 'builtin' | 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}

// 확장
type InlineToolDef = {
  description: string
  params?: Record<string, ZodSchema>
  handler: (params: any) => Promise<string | object | BrandedToolResult>
}

type ToolPort = {
  name: string
  type: 'builtin' | 'mcp-http' | 'mcp-stdio' | 'inline'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
  inline?: InlineToolDef
}
```

`type: 'inline'`인 경우 `inline` 필드가 반드시 존재한다. `toMcpConfig()`는 Codex 런타임용 MCP 브릿지에서 사용된다.

---

## 3. 런타임 어댑터

### 3.1 Claude 런타임

`buildMcpServers()`에서 `type: 'inline'` 도구를 분리한다:

```
tools[] → inline 분리 → MCP 도구 → mcpServers 옵션
                       → inline 도구 → SDK 네이티브 tool 등록 + 핸들러 직접 호출
```

Claude Agent SDK는 MCP 서버와 네이티브 tool을 동시에 지원하므로 양쪽이 공존한다.

인라인 도구의 핸들러 반환값은 SDK에 전달하기 전에 변환한다:
- `string` → `{ content: [{ type: 'text', text }] }`
- `object` → `{ content: [{ type: 'text', text: JSON.stringify(obj) }] }`
- `BrandedToolResult` → `{ content: result.content }`

### 3.2 Codex 런타임

인라인 도구들을 모아 자동으로 in-process MCP 서버를 하나 생성한다:

```
tools[] → inline 분리 → createInlineMcpBridge(inlineTools)
                         → McpServer 인스턴스 생성
                         → 각 인라인 도구를 server.tool()로 등록
                         → stdio transport로 연결
                       → MCP 도구 → 기존 경로 그대로
```

`createInlineMcpBridge()`는 `@sena-ai/core`에 구현한다:

```ts
function createInlineMcpBridge(tools: ToolPort[]): McpConfig {
  // inline 도구들만 필터링
  // McpServer 인스턴스 생성
  // 각 도구의 inline.handler를 server.tool()로 등록
  // StdioServerTransport 연결
  // McpConfig 반환
}
```

---

## 4. 마이그레이션

### 변경 필요

| 패키지 | 변경 내용 |
|--------|----------|
| `@sena-ai/core` | `ToolPort` 타입 확장, `defineTool()`, `toolResult()` export |
| `@sena-ai/runtime-claude` | 인라인 도구 네이티브 등록 로직 추가 |
| `@sena-ai/runtime-codex` | `createInlineMcpBridge()` 호출 추가 |
| `@sena-ai/tools-slack` | MCP 서버 방식 → `defineTool` 인라인으로 전환. `mcp-server.ts` 제거. `slackTools()`가 `ToolPort[]` 반환. |

### 삭제

| 패키지 | 이유 |
|--------|------|
| `@sena-ai/tools-obsidian` | 사용하지 않음 |

### 변경 없음

| 패키지 | 이유 |
|--------|------|
| `@sena-ai/tools` | 외부 MCP 서버 연결용 `mcpServer()` 여전히 필요 |
| `@sena-ai/connector-slack` | 도구와 무관 |
| `@sena-ai/engine` | `ToolPort[]`를 그대로 전달하는 구조, 변경 불필요 |
| `@sena-ai/worker` | 동일 |

---

## 5. 테스트 전략

### 단위 테스트

- `defineTool()` → 올바른 `ToolPort` 생성 확인 (`type: 'inline'`, `inline` 필드 존재)
- 핸들러 반환값 변환: `string`, `object`, `toolResult()` 각각 올바르게 변환
- 에러 처리: `throw` 시 `isError: true` 전파
- `toolResult()` 브랜드 심볼 검증

### 런타임 어댑터 테스트

- Claude: 인라인 도구가 네이티브 tool로 변환되는지
- Claude: 인라인 + MCP 도구 혼합 시 양쪽 모두 등록되는지
- Codex: 인라인 도구들이 MCP 브릿지로 묶이는지
- Codex: 브릿지 MCP 서버가 정상 응답하는지

### 핸들러 직접 테스트

인라인 도구의 핸들러는 순수 함수이므로 MCP 서버 없이 직접 호출하여 테스트 가능:

```ts
const tool = defineTool({ name: 'ping', handler: async () => 'pong' })
const result = await tool.inline!.handler({})
expect(result).toBe('pong')
```
