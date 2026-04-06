# 커스텀 도구 정의 및 MCP 연결

> English version: [tools-and-mcp.md](./tools-and-mcp.md)


## 인라인 도구 (defineTool)

```typescript
import { defineTool, toolResult } from '@sena-ai/core'
import { z } from 'zod'

const weatherTool = defineTool({
  name: 'get_weather',
  description: '지정한 도시의 현재 날씨를 조회합니다',
  params: {
    city: z.string().describe('도시 이름'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
  },
  handler: async ({ city, unit }) => {
    const data = await fetchWeather(city, unit)
    return `${city}: ${data.temp}°${unit === 'celsius' ? 'C' : 'F'}`
  },
})
```

### 반환 타입

| 반환값 | 처리 |
|---|---|
| `string` | 텍스트 콘텐츠로 전달 |
| `object` | `JSON.stringify()` 후 텍스트로 전달 |
| `toolResult([...])` | 멀티 콘텐츠 (텍스트 + 이미지 등) |

### 멀티 콘텐츠 반환 (이미지 포함)

```typescript
import { defineTool, toolResult } from '@sena-ai/core'

const screenshotTool = defineTool({
  name: 'take_screenshot',
  description: '스크린샷을 찍습니다',
  handler: async () => {
    const imageData = await captureScreen()
    return toolResult([
      { type: 'text', text: '스크린샷 완료' },
      { type: 'image', data: imageData, mimeType: 'image/png' },
    ])
  },
})
```

## Slack 도구

```typescript
import { slackTools, ALLOWED_SLACK_TOOLS } from '@sena-ai/tools-slack'

// 6개 도구를 한 번에 등록
const tools = slackTools({ botToken: env('SLACK_BOT_TOKEN') })
```

`ALLOWED_SLACK_TOOLS`는 `dontAsk` 모드에서 Slack 도구를 허용 목록에 추가할 때 사용:

```typescript
claudeRuntime({
  allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...ALLOWED_SLACK_TOOLS],
})
```

| 도구 | 설명 |
|---|---|
| `slack_get_messages` | 채널 히스토리 또는 스레드 답글 조회 |
| `slack_post_message` | 채널/스레드에 메시지 전송 |
| `slack_list_channels` | 접근 가능한 채널 목록 |
| `slack_upload_file` | 텍스트 콘텐츠를 파일로 업로드 |
| `slack_get_users` | 사용자 프로필 조회 |
| `slack_download_file` | 파일 다운로드 (이미지는 base64로 반환) |

## MCP 서버 연결

외부 MCP 서버를 도구로 등록할 수 있다.

### HTTP 기반 MCP

```typescript
const mcpHttpTool: McpToolPort = {
  name: 'my-mcp-server',
  type: 'mcp-http',
  toMcpConfig: () => ({ url: 'http://localhost:8080/mcp' }),
}
```

### stdio 기반 MCP

```typescript
const mcpStdioTool: McpToolPort = {
  name: 'filesystem',
  type: 'mcp-stdio',
  toMcpConfig: () => ({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  }),
}
```

### config에 등록

```typescript
export default defineConfig({
  tools: [mcpHttpTool, mcpStdioTool, ...slackTools({ botToken })],
  // ...
})
```

MCP 서버로 등록된 도구는 `dontAsk` 모드에서 자동으로 허용되므로 `allowedTools`에 별도 추가 불필요.

## disabledTools — 턴별 도구 비활성화

커넥터가 `InboundEvent`에 `disabledTools`를 지정하면 해당 턴에서 특정 도구를 비활성화할 수 있다 (blocklist 방식).

```typescript
engine.submitTurn({
  connector: 'my-platform',
  conversationId: '...',
  userId: '...',
  userName: '...',
  text: '...',
  raw: {},
  disabledTools: ['Bash', 'Write', 'Edit'],
})
```

### 동작 방식 (2단계 필터링)

1. **엔진 레벨**: `disabledTools`에 이름이 정확히 일치하는 ToolPort를 제거한다. MCP 서버나 인라인 도구를 통째로 빼고 싶을 때 사용한다.
2. **런타임 레벨**: 전체 `disabledTools` 패턴을 런타임에 전달한다. 런타임별로 자체 방식으로 적용한다.
   - **Claude**: SDK의 `disallowedTools`에 합쳐진다. 와일드카드 패턴(`mcp__server__*`), 개별 도구명, 빌트인 도구(Read, Bash 등) 모두 지원.

### 패턴 예시

```typescript
disabledTools: [
  'Bash',                    // Claude 빌트인 도구
  'Write',                   // Claude 빌트인 도구
  'mcp__slack-tools__*',     // MCP 서버 와일드카드 (서버 내 모든 도구)
  'mcp____native____my_tool', // 특정 인라인 도구
  'my-mcp-server',           // ToolPort 이름으로 MCP 서버 통째로 제거
]
```

### 활용 예시 — 조건별 도구 제한

```typescript
registerRoutes(server, engine) {
  server.post('/api/webhook', async (req, res) => {
    const event = parseEvent(req)

    // emoji 반응에서 트리거된 경우: 읽기 전용 도구만 허용
    const isEmojiTrigger = event.type === 'reaction_added'

    await engine.submitTurn({
      connector: 'my-platform',
      conversationId: event.channelId,
      userId: event.userId,
      userName: event.userName,
      text: event.text,
      raw: event,
      disabledTools: isEmojiTrigger
        ? ['Bash', 'Write', 'Edit', 'NotebookEdit']
        : undefined,
    })
  })
}
```

## 커스텀 커넥터에서 도구 제어

```typescript
import type { Connector, HttpServer, TurnEngine, ConnectorOutput } from '@sena-ai/core'

const myConnector: Connector = {
  name: 'my-platform',

  registerRoutes(server: HttpServer, engine: TurnEngine) {
    server.post('/api/my-platform/webhook', async (req, res) => {
      // 1. 요청 파싱 & 검증
      // 2. engine.submitTurn(inboundEvent) 호출
      // 3. 즉시 응답 반환
    })
  },

  createOutput(context) {
    return {
      async showProgress(text) { /* 진행 상태 표시 */ },
      async sendResult(text) { /* 최종 결과 전송 */ },
      async sendError(message) { /* 에러 메시지 전송 */ },
      async dispose() { /* 정리 작업 */ },
    }
  },
}
```
