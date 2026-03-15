# Sena Specification

> Sena는 Claude Code, Codex 등 코딩 에이전트 런타임을 활용하는 AI 에이전트 서버 프레임워크이다. 외부 플랫폼(Slack, Discord 등)에서 이벤트를 수신하고, 훅 파이프라인으로 컨텍스트를 조립하고, 런타임으로 실행하고, 결과를 다시 외부로 전송한다. 스케줄 태스크도 동일한 파이프라인으로 실행한다.

---

## 설계 목표

1. **추적 가능한 컨텍스트 조립**: LLM에 전달되는 모든 컨텍스트가 어디서 왔는지 추적할 수 있다. `TurnTrace`를 통해 각 훅이 무엇을 반환했고, 최종적으로 런타임에 전달된 텍스트가 무엇인지 확인할 수 있다.
2. **플랫폼 독립적 실행**: 커넥터 없이도 에이전트를 로컬에서 실행하고 테스트할 수 있다. 커넥터는 선택 사항이다.
3. **런타임 교체 가능**: Claude Code, Codex 등 런타임을 설정 한 줄로 교체할 수 있다. 런타임마다 다른 SDK 특성은 내부에 캡슐화된다.
4. **TypeScript 설정**: `sena.config.ts`가 설정의 단일 진실 원천이다. 타입 안전성, IDE 자동완성, 조건 로직을 지원한다.
5. **스케줄 핫리로드**: 스케줄 설정은 서버 재시작 없이 반영된다.

---

# Part 1: 아키텍처 개요

## 다섯 가지 추상화 계층

| 계층 | 역할 | 예시 |
|------|------|------|
| **Connector** | 외부 시스템과의 양방향 어댑터 (입력 수신 + 출력 전송) | Slack, Discord, HTTP, CLI |
| **Hook** | 턴 생명주기에 개입하여 컨텍스트 주입/후처리 수행 | 파일 컨텍스트, 메모리 로딩, 로깅 |
| **Runtime** | LLM 실행 엔진 추상화 | Claude Agent SDK, Codex SDK |
| **Tool Port** | 에이전트가 사용할 수 있는 MCP 도구 | Slack MCP, Obsidian MCP, 외부 MCP |
| **Scheduler** | 시간 기반 트리거로 턴을 자동 실행 | cron, heartbeat |

## 실행 모델

```
sena.config.ts
       │
       ▼
┌─────────────────────────────────┐
│  Orchestrator                   │  프로세스 관리, 무중단 재시작
│  └─ Worker                      │  실제 비즈니스 로직
│      ├─ Connector (Ingress)     │  외부 입력 수신 + 표준화
│      ├─ Hook Pipeline           │  컨텍스트 조립 + 후처리
│      ├─ Runtime                 │  LLM 실행
│      ├─ Tool Ports              │  MCP 도구
│      ├─ Connector (Egress)      │  외부 출력 전송
│      └─ Scheduler               │  스케줄 태스크 (핫리로드)
└─────────────────────────────────┘
```

## 핵심 원칙: 훅은 "무엇을", 런타임은 "어떻게"

훅은 **LLM에 넣을 컨텍스트 조각(`ContextFragment`)을 제공**한다. LLM API에 전달되는 메시지 형식은 **런타임이 결정**한다. 훅은 메시지 배열을 직접 조작하지 않는다.

```
훅이 하는 일:
  "이 파일 내용을 시스템 컨텍스트로 넣어라"
  → ContextFragment { source: 'file:soul.md', role: 'system', content: '...' }

런타임이 하는 일:
  ContextFragment[]를 받아 자신의 SDK에 맞는 방식으로 LLM에 전달
  (예: 시스템 프롬프트 append, developer_instructions 등)
```

---

# Part 2: `sena.config.ts`

## 전체 예시

```ts
import { defineConfig, env } from 'sena'
import { claudeRuntime } from 'sena/runtimes/claude'
import { slackConnector } from 'sena/connectors/slack'
import { slackTools } from 'sena/tools/slack'
import { obsidianTools } from 'sena/tools/obsidian'
import { mcpServer } from 'sena/tools'
import { fileContext, traceLogger, cronSchedule, heartbeat } from 'sena/hooks'

export default defineConfig({
  name: '숙희',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-5',
    apiKey: env('ANTHROPIC_API_KEY'),
  }),

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),
    }),
  ],

  tools: [
    slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
    obsidianTools({
      couchdbUrl: env('COUCHDB_URL'),
      couchdbUser: env('COUCHDB_USER'),
      couchdbPassword: env('COUCHDB_PASSWORD'),
    }),
    mcpServer({
      name: 'posthog',
      url: 'https://mcp.posthog.com/mcp',
      headers: { Authorization: `Bearer ${env('POSTHOG_API_KEY')}` },
    }),
  ],

  hooks: {
    onTurnStart: [
      fileContext({ path: './prompts/system.md', as: 'system' }),
      fileContext({ path: './prompts/soul.md', as: 'system' }),
      fileContext({ path: './memory/', as: 'system', glob: '*.md' }),
    ],
    onTurnEnd: [
      traceLogger({ dir: './traces' }),
    ],
  },

  schedules: [
    cronSchedule('0 * * * *', {
      name: '정각 알림',
      prompt: 'DO_EVERY_HOUR.md의 지시를 수행하세요',
    }),
    heartbeat('15m', {
      prompt: 'HEARTBEAT.md를 읽고 수행하세요',
    }),
  ],

  orchestrator: {
    port: 3100,
  },
})
```

## `defineConfig` 타입

```ts
type SenaConfig = {
  name: string
  runtime: Runtime
  connectors: Connector[]
  tools: ToolPort[]
  hooks: {
    onTurnStart?: TurnStartHook[]
    onTurnEnd?: TurnEndHook[]
    onError?: ErrorHook[]
  }
  schedules?: Schedule[]
  orchestrator?: OrchestratorConfig
}
```

## `env()` 헬퍼

```ts
env('ANTHROPIC_API_KEY')          // 필수. 없으면 시작 시 에러.
env('LOG_LEVEL', 'info')          // 선택. 기본값 지정.
```

설정 로딩 시점에 평가된다. 필수 환경 변수가 누락되면 서버 시작 전에 모든 누락을 한꺼번에 보고하고 실패한다.

---

# Part 3: Hook 시스템

## 턴(Turn)

턴은 **하나의 입력에 대한 전체 처리 과정**이다.

| 트리거 | 입력 출처 |
|--------|----------|
| `connector` | 외부 플랫폼 이벤트 (Slack 멘션, Discord 메시지 등) |
| `schedule` | 시간 기반 자동 실행 (cron, heartbeat) |
| `programmatic` | 코드에서 직접 호출 (`agent.processTurn()`) |

어떤 트리거든 **동일한 파이프라인**을 탄다:

```
onTurnStart 훅 → ContextFragment[] 수집
        │
        ▼
Runtime.createStream({ contextFragments, prompt, tools })
        │
        ├─ 런타임 이벤트 → ConnectorOutput으로 중계 (커넥터가 있는 경우)
        │
        ▼
onTurnEnd 훅 → TurnTrace 생성
```

## 훅 인터페이스

```ts
// 턴 시작 훅: 컨텍스트 조각을 반환한다.
// 여러 훅의 결과는 등록 순서대로 이어붙인다.
type TurnStartHook = {
  name: string
  execute(context: TurnContext): Promise<ContextFragment[]>
}

// 턴 종료 훅: 결과를 받아 후처리한다.
type TurnEndHook = {
  name: string
  execute(context: TurnContext, result: TurnResult): Promise<void>
}

// 에러 훅
type ErrorHook = {
  name: string
  execute(context: TurnContext, error: Error): Promise<void>
}
```

## ContextFragment

훅이 반환하는 컨텍스트의 최소 단위.

```ts
type ContextFragment = {
  source: string              // 출처 식별자 (추적용). 예: 'file:soul.md'
  role: 'system' | 'context'  // system: 지침/성격, context: 기억/참고자료
  content: string
}
```

런타임은 role에 따라 적절한 위치에 fragment를 배치한다. 배치 방식은 런타임 구현에 위임.

## TurnContext

```ts
type TurnContext = {
  turnId: string
  agentName: string
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string

  connector?: {                         // 커넥터 트리거일 때
    name: string
    conversationId: string
    userId: string
    userName: string
    files?: FileAttachment[]
    raw: unknown
  }

  schedule?: {                          // 스케줄 트리거일 때
    name: string
    type: 'cron' | 'heartbeat'
  }

  sessionId: string | null
  metadata: Record<string, unknown>     // 훅 간 데이터 전달용
}
```

## TurnResult

```ts
type TurnResult = {
  text: string
  sessionId: string | null
  durationMs: number
  toolCalls: { toolName: string; durationMs: number; isError: boolean }[]
}
```

## TurnTrace

**추적 가능성의 핵심.** 한 턴에서 일어난 모든 것을 기록한다.

```ts
type TurnTrace = {
  turnId: string
  timestamp: string
  agentName: string
  trigger: 'connector' | 'schedule' | 'programmatic'
  input: string

  hooks: {
    phase: 'onTurnStart' | 'onTurnEnd' | 'onError'
    name: string
    durationMs: number
    fragments: ContextFragment[]      // onTurnStart 훅만 해당
  }[]

  assembledContext: string            // 런타임에 실제로 전달된 최종 텍스트
  result: TurnResult | null
  error: string | null
}
```

활용:
- `trace.assembledContext` → LLM에 실제로 뭐가 들어갔는지
- `fragment.source` → 이 문장이 어디서 왔는지
- 스냅샷 테스트 → `TurnTrace`를 직렬화하여 비교
- `traceLogger` 훅 → 모든 trace를 파일로 덤프

## 기본 제공 훅

### `fileContext`

```ts
fileContext({
  path: './prompts/soul.md',       // 파일 또는 디렉터리
  as: 'system',                    // role
  glob: '*.md',                    // 디렉터리일 때 필터 (선택)
  when: (ctx) => true,             // 조건부 실행 (선택)
  maxLength: 10_000,               // 최대 문자수 (선택)
})
```

### `traceLogger`

```ts
traceLogger({
  dir: './traces',
  format: 'json',                  // 'json' | 'yaml'
})
```

### 커스텀 훅 작성

```ts
function myCustomContext(): TurnStartHook {
  return {
    name: 'my-custom-context',
    async execute(context: TurnContext): Promise<ContextFragment[]> {
      const data = await fetchFromMyAPI()
      return [{ source: 'custom:my-api', role: 'context', content: data }]
    },
  }
}
```

---

# Part 4: Connector

커넥터는 **외부 플랫폼과 Sena 코어를 잇는 양방향 어댑터**이다.

- **Ingress**: 플랫폼에서 이벤트를 수신하고, `InboundEvent`로 변환하여 턴을 접수.
- **Egress**: 런타임 이벤트를 받아 플랫폼에 맞는 형식으로 출력 (프로그레스, 최종 응답 등).

커넥터는 **선택 사항**이다. `connectors: []`이면 `agent.processTurn()`으로만 실행 가능.

## 인터페이스

```ts
type Connector = {
  name: string

  // Ingress: HTTP 라우트 등록. 이벤트 수신 → 검증 → InboundEvent 변환 → 턴 접수.
  registerRoutes(server: HttpServer, engine: TurnEngine): void

  // Egress: 특정 대화에 대한 출력 인터페이스 생성.
  createOutput(context: ConnectorOutputContext): ConnectorOutput
}

type InboundEvent = {
  connector: string
  conversationId: string
  userId: string
  userName: string
  text: string
  files?: FileAttachment[]
  raw: unknown                     // 플랫폼 원본 payload
}

type ConnectorOutput = {
  showProgress(text: string): Promise<void>   // 진행 표시 (쓰로틀링은 구현체 책임)
  sendResult(text: string): Promise<void>     // 최종 응답
  sendError(message: string): Promise<void>   // 에러
  dispose(): Promise<void>                    // 리소스 정리
}
```

## 기본 제공: Slack 커넥터

```ts
slackConnector({
  appId: env('SLACK_APP_ID'),
  botToken: env('SLACK_BOT_TOKEN'),
  signingSecret: env('SLACK_SIGNING_SECRET'),
})
```

Slack Events API 웹훅을 등록하고, 멘션 이벤트를 `InboundEvent`로 변환한다. Egress는 스레드에 메시지를 업데이트하는 방식으로 프로그레스와 최종 응답을 전달한다. 리액션 기반 중단도 처리한다.

---

# Part 5: Runtime

런타임은 **LLM SDK를 래핑**하여 통일된 이벤트 스트림을 제공한다. SDK별 차이(세션 관리, MCP 연결, 메시지 형식)는 런타임 내부에 캡슐화된다.

## 인터페이스

```ts
type Runtime = {
  name: string
  createStream(options: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent>
}

type RuntimeStreamOptions = {
  model: string
  contextFragments: ContextFragment[]
  prompt: AsyncIterable<UserMessage>
  tools: ToolPort[]
  sessionId: string | null
  cwd: string
  env: Record<string, string>
  abortSignal: AbortSignal
}

type RuntimeEvent =
  | { type: 'session.init'; sessionId: string }
  | { type: 'progress'; text: string }
  | { type: 'tool.start'; toolName: string }
  | { type: 'tool.end'; toolName: string; isError: boolean }
  | { type: 'result'; text: string }
  | { type: 'error'; message: string }
```

## 기본 제공 런타임

### `claudeRuntime`

```ts
claudeRuntime({
  model: 'claude-sonnet-4-5',
  apiKey: env('ANTHROPIC_API_KEY'),
})
```

`@anthropic-ai/claude-agent-sdk` 기반. MCP 네이티브 지원, 세션 재개 지원.

### `codexRuntime`

```ts
codexRuntime({
  model: 'gpt-5-codex',
  apiKey: env('CODEX_API_KEY'),
  reasoningEffort: 'medium',
})
```

`@openai/codex-sdk` 기반. 세션 재개 지원.

### 런타임 교체

```ts
// 한 줄만 바꾸면 된다
runtime: claudeRuntime({ ... }),
// runtime: codexRuntime({ ... }),
```

---

# Part 6: Tool Port

Tool Port는 **에이전트가 사용할 수 있는 MCP 도구의 선언**이다. 내장 도구와 외부 MCP 서버를 동일한 인터페이스로 다룬다. `tools` 배열에 선언한 것만 에이전트에 등록된다.

## 인터페이스

```ts
type ToolPort = {
  name: string
  type: 'builtin' | 'mcp-http' | 'mcp-stdio'
  toMcpConfig(runtime: RuntimeInfo): McpConfig
}
```

런타임이 `toMcpConfig()`를 호출하여 자신의 SDK에 맞는 MCP 설정을 얻는다.

## 기본 제공 도구

```ts
// Slack — 메시지 조회, 채널 목록, 메시지 전송, 파일 업로드/다운로드
slackTools({ botToken: env('SLACK_BOT_TOKEN') })

// Obsidian — CouchDB LiveSync 경유 노트 CRUD
obsidianTools({ couchdbUrl: ..., couchdbUser: ..., couchdbPassword: ... })

// 외부 MCP (HTTP)
mcpServer({ name: 'posthog', url: 'https://mcp.posthog.com/mcp', headers: { ... } })

// 외부 MCP (stdio)
mcpServer({ name: 'my-tool', command: 'node', args: ['./server.js'] })
```

---

# Part 7: Scheduler

Scheduler는 **시간 기반으로 턴을 자동 트리거**한다. 스케줄 턴은 일반 턴과 **동일한 훅 파이프라인**을 탄다.

## 스케줄 타입

```ts
// 5필드 cron (타임존: Asia/Seoul)
cronSchedule('0 * * * *', { name: '정각 알림', prompt: '...' })

// 고정 간격 반복
heartbeat('15m', { prompt: '...' })
```

## 스케줄 턴의 특성

- `TurnContext.trigger`가 `'schedule'`이다.
- 커넥터 출력이 없다. 에이전트가 `post_message` 도구 등으로 능동적으로 외부 전송하는 것은 가능.
- 훅에서 `when: (ctx) => ctx.trigger === 'schedule'`로 스케줄 전용 분기 가능.

## 핫리로드

스케줄을 별도 파일로 분리하면, 해당 파일 변경 시 서버 재시작 없이 스케줄이 교체된다. 진행 중인 턴은 끝까지 실행하고, 다음 tick부터 새 설정 적용.

**핫리로드 범위**: 스케줄만. runtime, connectors, hooks, tools 변경은 서버 재시작 필요.

---

# Part 8: 대화 관리

## 세션과 대화

| 개념 | 식별자 | 부여 주체 |
|------|--------|-----------|
| **대화(Conversation)** | `conversationId` | 커넥터 |
| **세션(Session)** | `sessionId` | 런타임 |
| **턴(Turn)** | `turnId` | 코어 |

하나의 대화는 여러 턴으로 구성된다. 같은 대화의 턴들이 같은 세션을 공유하여 이전 맥락을 유지한다.

## 세션 영속성

세션 ID를 `SessionStore`에 저장하여, 프로세스 재시작 후에도 대화를 이어간다.

```ts
type SessionStore = {
  get(conversationId: string): Promise<string | null>
  set(conversationId: string, sessionId: string): Promise<void>
  delete(conversationId: string): Promise<void>
}
```

## 유휴 타임아웃

일정 시간 입력이 없는 대화는 런타임 리소스를 정리한다. 세션 ID는 SessionStore에 남아 있으므로 이후 재개 가능.

---

# Part 9: Orchestrator–Worker

Sena 서버는 **Orchestrator**와 **Worker** 두 프로세스로 구성된다.

```
외부 트래픽
       │
┌──────▼──────────────────┐
│  Orchestrator            │  외부 포트 수신, Worker로 프록시
└──────┬──────────────────┘
       │ HTTP proxy
┌──────▼──────────────────┐
│  Worker                  │  커넥터, 훅, 런타임, 스케줄러 실행
└─────────────────────────┘
```

## 무중단 재시작

1. 새 Worker 스폰
2. 새 Worker health 체크 통과 대기
3. 트래픽 전환
4. 이전 Worker drain → 종료

각 Worker에 세대 번호(generation)를 부여하여 식별한다. Orchestrator는 상태를 파일로 영속화한다.

---

# Part 10: 테스트

## 훅 단위 테스트

```ts
test('fileContext가 파일을 로드한다', async () => {
  const hook = fileContext({ path: './fixtures/soul.md', as: 'system' })
  const fragments = await hook.execute(mockTurnContext())
  expect(fragments[0].content).toContain('숙희')
})
```

## 컨텍스트 스냅샷 테스트

```ts
test('시스템 프롬프트에 soul과 memory가 포함된다', async () => {
  const agent = await createAgent(config)
  const trace = await agent.processTurn({ input: '안녕' })

  expect(trace.assembledContext).toContain('당신은 숙희입니다')
  expect(trace.assembledContext).toMatchSnapshot()
})
```

## 커넥터 없이 로컬 실행

```ts
const agent = await createAgent({
  name: 'test',
  runtime: claudeRuntime({ model: 'claude-haiku-4-5', apiKey: env('ANTHROPIC_API_KEY') }),
  connectors: [],
  tools: [],
  hooks: { onTurnStart: [fileContext({ path: './prompts/system.md', as: 'system' })] },
})

const trace = await agent.processTurn({ input: '테스트' })
console.log(trace.result.text)
```

---

# Part 11: 전체 흐름

## 커넥터 트리거

```
1. 외부 플랫폼 → Connector가 수신 → InboundEvent 변환
2. SessionStore에서 기존 sessionId 조회
3. onTurnStart 훅 → ContextFragment[] 수집
4. Runtime.createStream() 실행
5. RuntimeEvent → ConnectorOutput으로 중계
   ├─ progress → showProgress()
   ├─ result → sendResult()
   └─ session.init → SessionStore에 저장
6. onTurnEnd 훅 → TurnTrace 생성
```

## 스케줄 트리거

```
1. Scheduler tick → cron/heartbeat 매칭
2. onTurnStart 훅 → ContextFragment[] 수집
3. Runtime.createStream() 실행 (ConnectorOutput 없음)
4. onTurnEnd 훅 → TurnTrace 생성
```

## 프로그래매틱 트리거

```
1. agent.processTurn({ input })
2. onTurnStart 훅 → ContextFragment[] 수집
3. Runtime.createStream() 실행
4. onTurnEnd 훅 → TurnTrace 반환
```
