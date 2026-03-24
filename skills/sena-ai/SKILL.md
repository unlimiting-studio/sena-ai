---
name: sena-ai
description: Use when building an AI agent with the @sena-ai framework — setting up sena.config.ts, connecting Slack or other platforms, defining tools, writing hooks, configuring cron jobs and heartbeats, or troubleshooting agent runtime issues.
---

# sena-ai Agent Framework

`@sena-ai`는 config-driven AI 에이전트 프레임워크다. `sena.config.ts` 하나로 런타임, 커넥터, 도구, 훅, 스케줄을 선언하고, CLI로 제로-다운타임 운영한다.

## When to Use

- 새 에이전트 프로젝트를 세팅할 때
- `sena.config.ts` 작성법이 필요할 때
- Slack/Telegram 등 커넥터를 연결할 때
- 커스텀 도구를 정의할 때
- 크론잡이나 하트비트를 설정할 때
- 훅으로 컨텍스트를 주입하거나 후처리를 할 때
- MCP 서버를 도구로 연결할 때

## Setup

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @sena-ai/core @sena-ai/cli @sena-ai/runtime-claude
```

필요에 따라 추가 패키지 설치:

```bash
npm install @sena-ai/connector-slack  # Slack 연결
npm install @sena-ai/tools-slack      # Slack 도구 (메시지 읽기/쓰기 등)
npm install @sena-ai/hooks            # 빌트인 훅 (fileContext, traceLogger)
```

`.env` 파일에 환경 변수 설정:

```env
SLACK_APP_ID=A0XXXXXXXXX
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

## sena.config.ts

모든 에이전트 설정의 진입점. `defineConfig()`으로 선언한다.

### Minimal Config

```typescript
import { defineConfig } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'

export default defineConfig({
  name: 'my-agent',
  runtime: claudeRuntime({ model: 'claude-sonnet-4-5' }),
})
```

### Full Config

```typescript
import { defineConfig, env, heartbeat, cronSchedule } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'
import { fileContext } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',
  cwd: './context/',  // 에이전트의 작업 디렉토리

  runtime: claudeRuntime({
    model: 'claude-opus-4-6',
    maxTurns: 100,                    // 기본값 100
    permissionMode: 'bypassPermissions', // 기본값 'bypassPermissions'
  }),

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),
      thinkingMessage: ':thinking: 생각 중...',  // false로 비활성화 가능
    }),
  ],

  tools: [
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
  ],

  hooks: {
    onTurnStart: [
      fileContext({ path: './context/SYSTEM.md', as: 'system' }),
      fileContext({ path: './context/memory/', as: 'context', glob: '*.md' }),
    ],
  },

  schedules: [
    heartbeat('1h', {
      name: 'heartbeat',
      prompt: '상태를 점검하세요.',
    }),
    cronSchedule('0 9 * * 1-5', {
      name: 'morning-briefing',
      prompt: '오늘의 일정을 정리해주세요.',
    }),
  ],

  orchestrator: { port: 3100 },
})
```

### Config Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | 에이전트 이름 |
| `cwd` | `string` | | 작업 디렉토리 (파일 읽기/쓰기 기준) |
| `runtime` | `Runtime` | ✅ | LLM 런타임 |
| `connectors` | `Connector[]` | | 입출력 채널 |
| `tools` | `ToolPort[]` | | 에이전트가 사용할 도구 |
| `hooks` | `object` | | 라이프사이클 훅 |
| `schedules` | `Schedule[]` | | 크론잡 & 하트비트 |
| `orchestrator` | `{ port?: number }` | | 오케스트레이터 포트 (기본 3100) |

## env() — 환경 변수

`env(key, default?)` 함수로 환경 변수를 안전하게 참조한다. 누락된 키를 수집해서 `validateEnv()`로 일괄 검증할 수 있다.

```typescript
import { env, validateEnv } from '@sena-ai/core'

const token = env('SLACK_BOT_TOKEN')           // 필수
const port = env('PORT', '3100')               // 기본값 있음

validateEnv()  // 누락된 env가 있으면 에러 throw (보통 직접 호출 불필요 — defineConfig 내부에서 처리)
```

## Runtime

### Claude Runtime

```typescript
import { claudeRuntime } from '@sena-ai/runtime-claude'

claudeRuntime({
  model?: string,           // 기본: 'claude-sonnet-4-5'
  apiKey?: string,          // 기본: ANTHROPIC_API_KEY 환경 변수
  maxTurns?: number,        // 기본: 100
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions',  // 기본: 'bypassPermissions'
})
```

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)를 사용한다.
- `bypassPermissions`이면 bash, 파일 수정 등에 대한 확인 없이 실행한다.
- 인라인 도구는 내부적으로 in-process MCP 서버(`__native__`)로 변환된다.

## Connectors

커넥터는 외부 플랫폼(Slack, Telegram 등)과 에이전트를 연결한다. 여러 커넥터를 동시에 사용할 수 있다.

### Slack Connector

```typescript
import { slackConnector } from '@sena-ai/connector-slack'

slackConnector({
  appId: string,
  botToken: string,
  signingSecret: string,
  thinkingMessage?: string | false,  // 기본: ':loading-dots: 세나가 생각중이에요'
})
```

- `POST /api/slack/events` 라우트를 등록한다.
- `app_mention`과 `message` 이벤트를 처리한다 (봇 메시지, 편집/삭제는 무시).
- HMAC-SHA256 서명 검증 (5분 리플레이 보호).
- 즉시 200 응답 후 비동기로 턴을 처리한다.
- 스레드 기반 세션: `conversationId = channelId:threadTs`.

### 커스텀 커넥터 작성

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

### 여러 커넥터 동시 사용

```typescript
export default defineConfig({
  // ...
  connectors: [
    slackConnector({ /* ... */ }),
    telegramConnector({ /* ... */ }),
    myCustomConnector,
  ],
})
```

각 커넥터는 독립적인 HTTP 라우트를 등록하므로 충돌 없이 동시 운영된다.

## Tools — 에이전트 도구

### 인라인 도구 (defineTool)

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

**반환 타입:**

| 반환값 | 처리 |
|---|---|
| `string` | 텍스트 콘텐츠로 전달 |
| `object` | `JSON.stringify()` 후 텍스트로 전달 |
| `toolResult([...])` | 멀티 콘텐츠 (텍스트 + 이미지 등) |

**멀티 콘텐츠 반환 (이미지 포함):**

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

### Slack 도구

```typescript
import { slackTools } from '@sena-ai/tools-slack'

// 6개 도구를 한 번에 등록
const tools = slackTools({ botToken: env('SLACK_BOT_TOKEN') })
```

| 도구 | 설명 |
|---|---|
| `slack_get_messages` | 채널 히스토리 또는 스레드 답글 조회 |
| `slack_post_message` | 채널/스레드에 메시지 전송 |
| `slack_list_channels` | 접근 가능한 채널 목록 |
| `slack_upload_file` | 텍스트 콘텐츠를 파일로 업로드 |
| `slack_get_users` | 사용자 프로필 조회 |
| `slack_download_file` | 파일 다운로드 (이미지는 base64로 반환) |

### MCP 서버 연결

외부 MCP 서버를 도구로 등록할 수 있다:

```typescript
// HTTP 기반 MCP
const mcpHttpTool: McpToolPort = {
  name: 'my-mcp-server',
  type: 'mcp-http',
  toMcpConfig: () => ({ url: 'http://localhost:8080/mcp' }),
}

// stdio 기반 MCP
const mcpStdioTool: McpToolPort = {
  name: 'filesystem',
  type: 'mcp-stdio',
  toMcpConfig: () => ({
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  }),
}

export default defineConfig({
  tools: [mcpHttpTool, mcpStdioTool, ...slackTools({ botToken })],
  // ...
})
```

## Hooks — 라이프사이클 훅

훅은 턴의 각 단계에서 실행되는 함수다. 세 가지 타이밍이 있다.

### onTurnStart — 컨텍스트 주입

턴 시작 전에 실행. `ContextFragment[]`를 반환하여 시스템 프롬프트에 주입한다.

```typescript
type TurnStartHook = {
  name: string
  execute(context: TurnContext): Promise<ContextFragment[]>
}

type ContextFragment = {
  source: string          // 표시 이름 (e.g. 'file:AGENTS.md')
  role: 'system' | 'context'  // system: 시스템 프롬프트, context: 참고 컨텍스트
  content: string
}
```

- `system` 역할: 에이전트의 행동 규칙, 정체성 등 (시스템 프롬프트 앞부분에 배치)
- `context` 역할: 참고 정보, 기억 등 (시스템 프롬프트 뒷부분에 배치)

### onTurnEnd — 후처리

턴이 성공적으로 완료된 후 실행. 로깅, 기록 저장 등에 사용한다.

```typescript
type TurnEndHook = {
  name: string
  execute(context: TurnContext, result: TurnResult): Promise<void>
}
```

### onError — 에러 처리

런타임 에러 발생 시 실행. 에러를 로깅하거나 알림을 보낼 때 사용한다.

```typescript
type ErrorHook = {
  name: string
  execute(context: TurnContext, error: Error): Promise<void>
}
```

### 빌트인 훅

#### fileContext — 파일/디렉토리를 컨텍스트로 주입

```typescript
import { fileContext } from '@sena-ai/hooks'

fileContext({
  path: string,          // 파일 경로 또는 디렉토리 경로
  as: 'system' | 'context',
  glob?: string,         // 디렉토리일 때 파일 필터 (e.g. '*.md')
  when?: (ctx: TurnContext) => boolean,  // 조건부 실행
  maxLength?: number,    // 콘텐츠 길이 제한
})
```

```typescript
// 단일 파일
fileContext({ path: './AGENTS.md', as: 'system' })

// 디렉토리 내 특정 패턴
fileContext({ path: './memory/', as: 'context', glob: '*.md' })

// 조건부 (Slack 커넥터일 때만)
fileContext({
  path: './slack-guide.md',
  as: 'system',
  when: (ctx) => ctx.connector?.name === 'slack',
})
```

#### traceLogger — 턴 추적 로그

```typescript
import { traceLogger } from '@sena-ai/hooks'

// onTurnEnd에 추가
hooks: {
  onTurnEnd: [
    traceLogger({ dir: './traces/' }),  // {turnId}-{timestamp}.json 파일 생성
  ],
}
```

### 커스텀 훅 작성

```typescript
import type { TurnStartHook, TurnContext, ContextFragment } from '@sena-ai/core'

const myHook: TurnStartHook = {
  name: 'my-hook',
  async execute(context: TurnContext): Promise<ContextFragment[]> {
    // context.trigger: 'connector' | 'schedule' | 'programmatic'
    // context.connector?: { name, conversationId, userId, userName }
    // context.schedule?: { name, type: 'cron' | 'heartbeat' }

    if (context.trigger !== 'connector') return []

    const data = await fetchSomeData(context.connector!.userId)
    return [{
      source: 'my-hook',
      role: 'context',
      content: `User preferences: ${JSON.stringify(data)}`,
    }]
  },
}
```

## Schedules — 크론잡 & 하트비트

스케줄은 외부 입력 없이 에이전트가 자율적으로 턴을 실행하게 만든다.

### Heartbeat — 고정 간격 실행

```typescript
import { heartbeat } from '@sena-ai/core'

heartbeat(interval: string, options: {
  name?: string,
  prompt: string,
})
```

- `interval` 형식: `'30s'`, `'15m'`, `'1h'`
- 에이전트 시작 시 **즉시 1회 실행**, 이후 간격마다 반복
- 동시 실행 방지: 이전 턴이 진행 중이면 스킵

```typescript
heartbeat('1h', {
  name: 'health-check',
  prompt: '시스템 상태를 점검하세요.',
})
```

### Cron — 정확한 시간 기반 실행

```typescript
import { cronSchedule } from '@sena-ai/core'

cronSchedule(expression: string, options: {
  name: string,
  prompt: string,
})
```

- `expression`: 5필드 cron 형식 (minute hour day month weekday)
- 타임존: `Asia/Seoul` (하드코딩)
- 지원 문법: `*`, `*/n` (스텝), `n-m` (범위), `n,m,...` (리스트)
- 에이전트 시작 시 실행하지 않음 — cron 표현식과 일치하는 시간에만 실행

```typescript
// 평일 매일 오전 9시
cronSchedule('0 9 * * 1-5', {
  name: 'morning-briefing',
  prompt: '오늘의 일정을 정리하고 Slack에 공유하세요.',
})

// 30분마다 (:13, :43에)
cronSchedule('13,43 * * * *', {
  name: 'email-check',
  prompt: '미읽음 이메일을 확인하세요.',
})
```

### Heartbeat vs Cron 선택 기준

| | Heartbeat | Cron |
|---|---|---|
| 시간 정확도 | 시작 시점 기준 상대적 | 절대 시간 |
| 시작 시 즉시 실행 | ✅ | ❌ |
| 사용 예 | 상태 점검, 메모리 정리 | 일정 알림, 정기 리포트 |

## CLI

```bash
sena start              # 포그라운드 실행
sena start -d           # 데몬 모드 (sena.log에 로그 출력)
sena stop               # 정상 종료 (SIGTERM → 10s 대기 → SIGKILL)
sena restart            # 제로-다운타임 워커 교체 (SIGUSR2)
sena restart --full     # 전체 프로세스 재시작
sena status             # PID + health endpoint 확인
sena logs               # tail -f sena.log
```

`sena restart`는 오케스트레이터에 SIGUSR2를 보내서 새 워커를 띄우고, 준비되면 트래픽을 전환하고, 이전 워커를 drain한다. 설정 파일(sena.config.ts) 변경 후 적용할 때 유용하다.

## Architecture

```
Orchestrator (public port)
  └─ Worker (forked child process, internal random port)
       ├─ HTTP Server
       │    ├─ /health → 200 ok
       │    └─ Connector routes (e.g. /api/slack/events)
       ├─ TurnEngine
       │    ├─ [1] Auto-inject connector metadata
       │    ├─ [2] Run onTurnStart hooks → ContextFragment[]
       │    ├─ [3] Assemble context (system fragments first, then context)
       │    ├─ [4] Runtime.createStream() → stream events
       │    ├─ [5] Run onTurnEnd hooks (success) or onError hooks (failure)
       │    └─ Return TurnTrace
       ├─ Scheduler
       │    ├─ Heartbeat intervals (setInterval)
       │    └─ Cron polling (60s tick, Asia/Seoul timezone)
       └─ SessionStore (.sessions.json)
            └─ conversationId → sessionId mapping
```

### Turn Flow

1. 커넥터가 메시지를 수신하면 `engine.submitTurn(event)`를 호출한다.
2. 커넥터 메타데이터가 자동 주입된다 (`[Current Message Context]`).
3. `onTurnStart` 훅들이 순서대로 실행되어 `ContextFragment[]`를 모은다.
4. 모든 프래그먼트가 시스템 프롬프트로 조립된다.
5. 런타임이 스트리밍 실행되고, 도구 호출/결과를 처리한다.
6. **Steer**: 턴 진행 중 같은 스레드에 새 메시지가 오면, tool boundary에서 기존 턴에 주입한다.
7. 결과를 커넥터를 통해 전송한다.

### Session Management

- `conversationId` (e.g. `channelId:threadTs`) → `sessionId` 매핑
- 파일 기반 (`cwd/.sessions.json`) — 재시작 후에도 유지
- Claude SDK의 `resume` 옵션으로 기존 세션을 이어간다.

## TurnContext Reference

훅과 내부 처리에서 사용하는 턴 컨텍스트:

```typescript
type TurnContext = {
  turnId: string              // UUID
  agentName: string           // defineConfig의 name
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string               // 사용자 메시지 또는 스케줄 프롬프트
  connector?: {
    name: string              // 커넥터 이름 (e.g. 'slack')
    conversationId: string    // e.g. 'C0AFW5Y133J:1234567890.123456'
    userId: string
    userName: string
    files?: FileAttachment[]
    raw: unknown              // 원본 이벤트 데이터
  }
  schedule?: {
    name: string              // 스케줄 이름
    type: 'cron' | 'heartbeat'
  }
  sessionId: string | null
  metadata: Record<string, unknown>
}
```

## Common Patterns

### 파일 기반 에이전트 페르소나

```typescript
hooks: {
  onTurnStart: [
    fileContext({ path: './persona/IDENTITY.md', as: 'system' }),
    fileContext({ path: './persona/RULES.md', as: 'system' }),
    fileContext({ path: './persona/MEMORY.md', as: 'context' }),
  ],
}
```

### 채널별 컨텍스트 주입 (커스텀 훅)

```typescript
const channelHook: TurnStartHook = {
  name: 'channel-context',
  async execute(ctx) {
    if (ctx.trigger !== 'connector') return []
    const channelId = ctx.connector!.conversationId.split(':')[0]
    const config = JSON.parse(await readFile('./channels.json', 'utf-8'))
    const channel = config[channelId]
    if (!channel) return []
    return [{
      source: `channel:${channelId}`,
      role: 'context',
      content: `Channel: #${channel.name}\nDescription: ${channel.description}`,
    }]
  },
}
```

### 오늘 + 어제 메모리만 주입

```typescript
function recentMemoryGlob(): string {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  return `{${yesterday},${today}}.md`
}

fileContext({ path: './memory/', as: 'context', glob: recentMemoryGlob() })
```

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| `EADDRINUSE` | 포트 충돌 | `orchestrator.port`를 변경하거나 기존 프로세스를 종료 |
| Slack 3s timeout 에러 | 이벤트 핸들러가 너무 느림 | 커넥터가 즉시 200을 반환하므로 보통 문제 아님. 로그 확인 |
| 턴이 실행되지 않음 | 세션 스토어 파일 깨짐 | `.sessions.json` 삭제 후 재시작 |
| 크론이 안 도는 것 같음 | 시작 시 즉시 실행 안 됨 | cron은 표현식 매칭 시에만 실행. 즉시 실행이 필요하면 heartbeat 사용 |
| `env()` 에러 | `.env` 파일 누락 또는 키 누락 | `.env` 파일 확인 |
