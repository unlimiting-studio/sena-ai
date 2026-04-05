# sena.config.ts 작성 및 관리

모든 에이전트 설정의 진입점. `defineConfig()`으로 선언한다.

## Full Config 예시

```typescript
import { defineConfig, env, heartbeat, cronSchedule } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'
import { fileContext } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',
  cwd: './context/',

  runtime: claudeRuntime({
    model: 'claude-opus-4-6',
    maxTurns: 100,
    permissionMode: 'bypassPermissions',
  }),

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),
      thinkingMessage: ':thinking: 생각 중...',
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

## Config Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | Y | 에이전트 이름 |
| `cwd` | `string` | | 작업 디렉토리 (파일 읽기/쓰기 기준) |
| `runtime` | `Runtime` | Y | LLM 런타임 |
| `connectors` | `Connector[]` | | 입출력 채널 |
| `tools` | `ToolPort[]` | | 에이전트가 사용할 도구 |
| `hooks` | `object` | | 라이프사이클 훅 |
| `schedules` | `Schedule[]` | | 크론잡 & 하트비트 |
| `orchestrator` | `{ port?: number }` | | 오케스트레이터 포트 (기본 3100) |

## env() — 환경 변수

`env(key, default?)` 함수로 환경 변수를 안전하게 참조한다.

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

### permissionMode

| 모드 | 동작 |
|---|---|
| `default` | 위험 작업마다 터미널 프롬프트 (비대화형 환경에서 사용 불가) |
| `acceptEdits` | 파일 수정 자동 승인, 나머지 프롬프트 |
| **`dontAsk`** | **기본값.** 프롬프트 없음. `allowedTools`에 없으면 자동 거부 |
| `bypassPermissions` | 전부 스킵. 기존 에이전트는 이걸 명시적으로 지정해야 기존 동작 유지 |
| `plan` | 도구 실행 안 함, 계획만 |

### DEFAULT_ALLOWED_TOOLS

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
import { ALLOWED_SLACK_TOOLS } from '@sena-ai/tools-slack'

claudeRuntime({
  permissionMode: 'dontAsk',
  allowedTools: [...DEFAULT_ALLOWED_TOOLS, ...ALLOWED_SLACK_TOOLS],
})
```

MCP 서버로 등록된 도구(`tools` config)는 자동으로 허용되므로 별도 추가 불필요.

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

### 빌트인 훅: fileContext

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

### 빌트인 훅: traceLogger

```typescript
import { traceLogger } from '@sena-ai/hooks'

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
| 시작 시 즉시 실행 | Y | N |
| 사용 예 | 상태 점검, 메모리 정리 | 일정 알림, 정기 리포트 |

## TurnContext Reference

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
