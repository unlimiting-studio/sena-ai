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
npm install @sena-ai/slack             # Slack 커넥터 + 도구
npm install @sena-ai/hooks            # 빌트인 훅 (fileContextHook, traceLoggerHook)
```

`.env` 파일에 환경 변수 설정:

```env
SLACK_APP_ID=A0XXXXXXXXX
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-1-...
```

## sena.config.ts

모든 에이전트 설정의 진입점. `defineConfig()`으로 선언한다.

### Minimal Config

```typescript
import { defineConfig } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'

export default defineConfig({
  name: 'my-agent',
  runtime: claudeRuntime({ model: 'claude-sonnet-4-6' }),
})
```

### Full Config

```typescript
import { defineConfig, env, heartbeat, cronSchedule } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector, slackTools } from '@sena-ai/slack'
import { fileContextHook } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',
  cwd: './context/',  // 에이전트의 작업 디렉토리

  runtime: claudeRuntime({
    model: 'claude-opus-4-6',
    maxTurns: 100,                    // 기본값 100
    permissionMode: 'bypassPermissions', // 기본값 'dontAsk' — 기존 에이전트는 명시적으로 지정
  }),

  connectors: [
    slackConnector({
      mode: 'socket',
      appId: env('SLACK_APP_ID'),
      appToken: env('SLACK_APP_TOKEN'),
      botToken: env('SLACK_BOT_TOKEN'),
      thinkingMessage: ':thinking: 생각 중...',  // false로 비활성화 가능
    }),
  ],

  tools: [
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
  ],

  hooks: {
    onTurnStart: [
      fileContextHook({ path: './context/SYSTEM.md', as: 'system' }),
      fileContextHook({ path: './context/memory/', as: 'append', glob: '*.md' }),
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
import { claudeRuntime, DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'

claudeRuntime({
  model?: string,           // 기본: 'claude-sonnet-4-5'
  apiKey?: string,          // 기본: ANTHROPIC_API_KEY 환경 변수
  maxTurns?: number,        // 기본: 100
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk',  // 기본: 'dontAsk'
  allowedTools?: string[],  // dontAsk 모드에서 자동 승인할 도구 (기본: DEFAULT_ALLOWED_TOOLS)
  disallowedTools?: string[], // 항상 차단할 도구 패턴 (per-turn disabledTools와 합산)
})
```

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)를 사용한다.
- 인라인 도구는 내부적으로 in-process MCP 서버(`__native__`)로 변환된다.

#### permissionMode

| 모드 | 동작 |
|---|---|
| `default` | 위험 작업마다 터미널 프롬프트 (비대화형 환경에서 사용 불가) |
| `acceptEdits` | 파일 수정 자동 승인, 나머지 프롬프트 |
| **`dontAsk`** | **기본값.** 프롬프트 없음. `allowedTools`에 없으면 자동 거부 |
| `bypassPermissions` | 전부 스킵. 기존 에이전트는 이걸 명시적으로 지정해야 기존 동작 유지 |
| `plan` | 도구 실행 안 함, 계획만 |

#### DEFAULT_ALLOWED_TOOLS

`dontAsk` 모드에서 `allowedTools`를 지정하지 않으면 자동으로 적용되는 프리셋:

```typescript
import { DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'

// DEFAULT_ALLOWED_TOOLS 내용:
// File operations: Read, Write, Edit, MultiEdit
// Search & navigation: Glob, Grep, LS
// Execution: Bash
// Notebooks: NotebookRead, NotebookEdit
// Agent & planning: Agent, ToolSearch
```

Slack 도구 등 추가 도구가 필요하면 `allowedTools`에 합쳐서 지정:

```typescript
import { DEFAULT_ALLOWED_TOOLS } from '@sena-ai/runtime-claude'
import { ALLOWED_SLACK_TOOLS } from '@sena-ai/slack'

claudeRuntime({
  permissionMode: 'dontAsk',
  allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...ALLOWED_SLACK_TOOLS],
})
```

MCP 서버로 등록된 도구(`tools` config)는 자동으로 허용되므로 별도 추가 불필요.

## Connectors

커넥터는 외부 플랫폼(Slack, Telegram 등)과 에이전트를 연결한다. 여러 커넥터를 동시에 사용할 수 있다.

### Slack Connector

HTTP Events API와 Socket Mode 두 가지 모드를 지원한다.

#### HTTP Mode (기본)

공인 엔드포인트가 있는 서버에서 사용. Slack이 직접 POST 요청을 보낸다.

```typescript
import { slackConnector } from '@sena-ai/slack'

slackConnector({
  appId: env('SLACK_APP_ID'),
  botToken: env('SLACK_BOT_TOKEN'),
  signingSecret: env('SLACK_SIGNING_SECRET'),
  // mode: 'http',  // 생략 가능 (기본값)
  thinkingMessage: ':thinking: 생각 중...',  // false로 비활성화
})
```

- `POST /api/slack/events` 라우트를 등록한다.
- HMAC-SHA256 서명 검증 (5분 리플레이 보호).

#### Socket Mode

방화벽 뒤 서버나 로컬 개발 환경에서 사용. 공인 엔드포인트 불필요.

```typescript
slackConnector({
  appId: env('SLACK_APP_ID'),
  botToken: env('SLACK_BOT_TOKEN'),
  mode: 'socket',
  appToken: env('SLACK_APP_TOKEN'),  // xapp-… (App-Level Token)
  thinkingMessage: ':thinking: 생각 중...',
})
```

`.env`:

```env
SLACK_APP_TOKEN=xapp-1-...
```

**App-Level Token 발급:**
1. https://api.slack.com/apps → 앱 선택
2. Settings > Basic Information > App-Level Tokens
3. `connections:write` scope로 토큰 생성 → `xapp-` 접두사 토큰 발급

**Slack 앱에서 Socket Mode 활성화:**
1. Settings > Socket Mode → Enable Socket Mode 토글 ON
2. Event Subscriptions는 그대로 유지 (Request URL은 Socket Mode에서 무시됨)

#### 모드 선택 기준

| | HTTP Mode | Socket Mode |
|---|---|---|
| 공개 엔드포인트 | 필요 | 불필요 |
| 필요한 키 | `signingSecret` | `appToken` (xapp-…) |
| 방화벽 뒤 | 불가 | 가능 |
| 권장 환경 | 프로덕션 | 로컬, 방화벽 뒤 서버 |

#### 타입 정의

`mode`에 따라 필요한 키가 달라지는 discriminated union:

```typescript
type SlackConnectorOptions = {
  appId: string
  botToken: string
  thinkingMessage?: string | false
} & (
  | { mode?: 'http'; signingSecret: string; appToken?: never }
  | { mode: 'socket'; appToken: string; signingSecret?: never }
)
```

#### 공통 동작

- `app_mention`, `message`, `reaction_added` 이벤트를 처리한다 (봇 메시지, 편집/삭제는 무시).
- 즉시 응답 후 비동기로 턴을 처리한다.
- 스레드 기반 세션: `conversationId = channelId:threadTs`.
- `stop()` 라이프사이클: Socket Mode에서 drain 시 WebSocket을 정상 종료한다.

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

### disabledTools — 턴별 도구 비활성화

커넥터가 `InboundEvent`에 `disabledTools`를 지정하면 해당 턴에서 특정 도구를 비활성화할 수 있다 (blocklist 방식).

```typescript
engine.submitTurn({
  connector: 'my-platform',
  conversationId: '...',
  userId: '...',
  userName: '...',
  text: '...',
  raw: {},
  // 이 턴에서 비활성화할 도구 목록
  disabledTools: ['Bash', 'Write', 'Edit'],
})
```

**동작 방식 (2단계 필터링):**

1. **엔진 레벨**: `disabledTools`에 이름이 정확히 일치하는 ToolPort를 제거한다. MCP 서버나 인라인 도구를 통째로 빼고 싶을 때 사용한다.
2. **런타임 레벨**: 전체 `disabledTools` 패턴을 런타임에 전달한다. 런타임별로 자체 방식으로 적용한다.
   - **Claude**: SDK의 `disallowedTools`에 합쳐진다. 와일드카드 패턴(`mcp__server__*`), 개별 도구명, 빌트인 도구(Read, Bash 등) 모두 지원.
   - **Codex**: ToolPort 레벨 필터링으로 처리.

**패턴 예시:**

```typescript
disabledTools: [
  'Bash',                    // Claude 빌트인 도구
  'Write',                   // Claude 빌트인 도구
  'mcp__slack-tools__*',     // MCP 서버 와일드카드 (서버 내 모든 도구)
  'mcp____native____my_tool', // 특정 인라인 도구
  'my-mcp-server',           // ToolPort 이름으로 MCP 서버 통째로 제거
]
```

**활용 예시 — 조건별 도구 제한:**

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
import { slackTools, ALLOWED_SLACK_TOOLS } from '@sena-ai/slack'

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

훅은 턴의 각 단계에서 실행되는 콜백 함수다. `RuntimeHooks` 객체에 배열로 등록한다.

```typescript
type RuntimeHooks = {
  onPreToolUse?: ToolHookMatcher<PreToolUseCallback>[]
  onPostToolUse?: ToolHookMatcher<PostToolUseCallback>[]
  onTurnStart?: TurnStartCallback[]
  onTurnEnd?: TurnEndCallback[]
  onStop?: StopCallback[]
  onSessionStart?: SessionStartCallback[]
  onError?: ErrorCallback[]
}
```

### onTurnStart — 컨텍스트 주입 & 턴 제어

턴 시작 전에 실행. 추가 컨텍스트를 주입하거나, 턴을 차단하거나, 프롬프트를 수정할 수 있다.

```typescript
type TurnStartCallback = (input: TurnStartInput) => Promise<TurnStartDecision>

type TurnStartDecision =
  | { decision: 'allow' }
  | { decision: 'allow'; additionalContext: string }
  | { decision: 'block'; reason: string }
  | { decision: 'modifiedPrompt'; prompt: string }
  | { decision: 'modifiedPrompt'; prompt: string; additionalContext: string }
```

### onTurnEnd — 후처리

턴이 성공적으로 완료된 후 실행. 로깅, 기록 저장 등에 사용한다.

```typescript
type TurnEndCallback = (input: TurnEndInput) => Promise<void>
```

### onError — 에러 처리

런타임 에러 발생 시 실행. 에러를 로깅하거나 알림을 보낼 때 사용한다.

```typescript
type ErrorCallback = (input: ErrorInput) => Promise<void>
```

### onStop — 턴 종료 제어

런타임이 턴을 끝내려 할 때 실행. `continueWith`를 반환하면 후속 턴을 이어갈 수 있다.

```typescript
type StopCallback = (input: StopInput) => Promise<void | { continueWith: string }>
```

### 빌트인 훅

#### fileContextHook — 파일/디렉토리를 컨텍스트로 주입

```typescript
import { fileContextHook } from '@sena-ai/hooks'

fileContextHook({
  path: string,                        // 파일 경로 또는 디렉토리 경로
  as: 'system' | 'prepend' | 'append',
  glob?: string,                       // 디렉토리일 때 파일 필터 (e.g. '*.md')
  when?: (ctx: TurnContext) => boolean, // 조건부 실행
  maxLength?: number,                  // 콘텐츠 길이 제한
})
```

```typescript
// 단일 파일
fileContextHook({ path: './AGENTS.md', as: 'system' })

// 디렉토리 내 특정 패턴
fileContextHook({ path: './memory/', as: 'append', glob: '*.md' })

// 조건부 (특정 트리거일 때만)
fileContextHook({
  path: './slack-guide.md',
  as: 'system',
  when: (ctx) => ctx.trigger === 'connector',
})
```

#### traceLoggerHook — 턴 추적 로그

```typescript
import { traceLoggerHook } from '@sena-ai/hooks'

hooks: {
  onTurnEnd: [
    traceLoggerHook({ dir: './traces/' }),  // {turnId}-{timestamp}.json 파일 생성
  ],
}
```

### 커스텀 훅 작성

```typescript
import type { TurnStartCallback, TurnStartInput, TurnStartDecision } from '@sena-ai/core'

const myHook: TurnStartCallback = async (input: TurnStartInput): Promise<TurnStartDecision> => {
  const { turnContext } = input
  // turnContext.trigger: 'connector' | 'schedule' | 'programmatic'
  // turnContext.connector?: { name, conversationId, userId, userName }
  // turnContext.schedule?: { name, type: 'cron' | 'heartbeat' }

  if (turnContext.trigger !== 'connector') return { decision: 'allow' }

  const data = await fetchSomeData(turnContext.connector!.userId)
  return {
    decision: 'allow',
    additionalContext: `User preferences: ${JSON.stringify(data)}`,
  }
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

## CLI & 재시작

```bash
sena start              # 포그라운드 실행
sena start -d           # 데몬 모드 (sena.log에 로그 출력)
sena stop               # 정상 종료 (SIGTERM → 10s 대기 → SIGKILL)
sena restart --full     # 전체 프로세스 재시작 (포트/커넥터 변경 시)
sena status             # PID + health endpoint 확인
sena logs               # tail -f sena.log
```

### restart_agent 도구 (내장)

일반적인 재시작은 에이전트가 내장 도구 `restart_agent`를 호출해서 수행한다. `sena.config.ts`를 수정한 뒤 이 도구를 호출하면 워커가 새 설정으로 제로-다운타임 교체된다.

CLI의 `sena restart --full`은 프로세스 전체를 내려야 할 때만 사용한다 (포트 변경, 커넥터 추가/제거 등).

**주의:** 에이전트가 현재 턴 안에서 셸로 `sena restart --full`이나 `sena stop`을 직접 실행하면 데드락이 발생한다. 내부 재시작은 반드시 `restart_agent` 도구만 사용해야 한다.

## Architecture

```
Orchestrator (public port)
  └─ Worker (forked child process, internal random port)
       ├─ HTTP Server
       │    ├─ /health → 200 ok
       │    └─ Connector routes (e.g. /api/slack/events)
       ├─ TurnEngine
       │    ├─ [1] Auto-inject connector metadata
       │    ├─ [2] Run onTurnStart hooks → additionalContext
       │    ├─ [3] Assemble system prompt with context
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
    disabledTools?: string[]  // 이 턴에서 비활성화된 도구 목록
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
    fileContextHook({ path: './persona/IDENTITY.md', as: 'system' }),
    fileContextHook({ path: './persona/RULES.md', as: 'system' }),
    fileContextHook({ path: './persona/MEMORY.md', as: 'append' }),
  ],
}
```

### 채널별 컨텍스트 주입 (커스텀 훅)

```typescript
import type { TurnStartCallback } from '@sena-ai/core'

const channelHook: TurnStartCallback = async (input) => {
  const { turnContext } = input
  if (turnContext.trigger !== 'connector') return { decision: 'allow' }

  const channelId = turnContext.connector!.conversationId.split(':')[0]
  const config = JSON.parse(await readFile('./channels.json', 'utf-8'))
  const channel = config[channelId]
  if (!channel) return { decision: 'allow' }

  return {
    decision: 'allow',
    additionalContext: `Channel: #${channel.name}\nDescription: ${channel.description}`,
  }
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

fileContextHook({ path: './memory/', as: 'append', glob: recentMemoryGlob() })
```

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| `EADDRINUSE` | 포트 충돌 | `orchestrator.port`를 변경하거나 기존 프로세스를 종료 |
| Slack 3s timeout 에러 | 이벤트 핸들러가 너무 느림 | 커넥터가 즉시 200을 반환하므로 보통 문제 아님. 로그 확인 |
| 턴이 실행되지 않음 | 세션 스토어 파일 깨짐 | `.sessions.json` 삭제 후 재시작 |
| 크론이 안 도는 것 같음 | 시작 시 즉시 실행 안 됨 | cron은 표현식 매칭 시에만 실행. 즉시 실행이 필요하면 heartbeat 사용 |
| `env()` 에러 | `.env` 파일 누락 또는 키 누락 | `.env` 파일 확인 |
