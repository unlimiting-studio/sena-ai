# Sena

Slack 이벤트를 수신하여 AI 에이전트(Claude, Codex)를 실행하는 서버 프레임워크.
`sena.config.ts` 하나로 런타임, 커넥터, 도구, 훅, 스케줄을 설정한다.

## 빠른 시작

```bash
pnpm install
cp .env.example .env   # API 키 등 환경변수 설정
pnpm build
pnpm start
```

## 설정 예시

```ts
import { defineConfig, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'
import { fileContext, traceLogger, cronSchedule, heartbeat } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',

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
  ],

  hooks: {
    onTurnStart: [
      fileContext({ path: './prompts/system.md', as: 'system' }),
    ],
    onTurnEnd: [
      traceLogger({ dir: './traces' }),
    ],
  },

  schedules: [
    cronSchedule('0 * * * *', { name: '정각 알림', prompt: '...' }),
    heartbeat('15m', { prompt: 'HEARTBEAT.md를 읽고 수행하세요' }),
  ],
})
```

## 아키텍처

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
│      └─ Scheduler               │  스케줄 태스크
└─────────────────────────────────┘
```

외부 플랫폼(Slack 등)에서 이벤트를 수신하면 훅 파이프라인으로 컨텍스트를 조립하고, 런타임으로 LLM을 실행하고, 결과를 다시 외부로 전송한다. 스케줄 태스크도 동일한 파이프라인으로 실행된다.

## 패키지 구조

| 패키지 | 역할 |
|--------|------|
| `@sena-ai/core` | 프레임워크 코어 — `defineConfig`, `env`, `createAgent`, `TurnEngine` |
| `@sena-ai/hooks` | 기본 제공 훅 — `fileContext`, `traceLogger`, `cronSchedule`, `heartbeat` |
| `@sena-ai/tools` | 외부 MCP 서버 연결 헬퍼 — `mcpServer` |
| `@sena-ai/tools-slack` | Slack MCP 도구 — 메시지 조회/전송, 파일 업로드/다운로드 |
| `@sena-ai/connector-slack` | Slack 커넥터 — Events API 수신 + 스레드 응답 |
| `@sena-ai/runtime-claude` | Claude Agent SDK 기반 런타임 |
| `@sena-ai/runtime-codex` | Codex App Server 기반 런타임 |
| `@sena-ai/cli` | CLI — `start`, `stop`, `restart`, `status`, `logs` |

```
sena/
├── packages/
│   ├── core/
│   ├── hooks/
│   ├── tools/
│   ├── tools-slack/
│   ├── connector-slack/
│   ├── runtime-claude/
│   ├── runtime-codex/
│   └── cli/
├── agent/              에이전트 실행 설정 (sena.yaml 등)
├── tests/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## 핵심 개념

### 턴(Turn)

턴은 하나의 입력에 대한 전체 처리 과정이다. 커넥터 이벤트, 스케줄 트리거, 코드 직접 호출 모두 동일한 파이프라인을 탄다.

```
onTurnStart 훅 → ContextFragment[] 수집 → Runtime.createStream() → onTurnEnd 훅
```

### 훅(Hook)

훅은 턴 생명주기에 개입하여 컨텍스트 주입과 후처리를 수행한다. "무엇을" LLM에 넣을지는 훅이, "어떻게" 전달할지는 런타임이 결정한다.

```ts
// 커스텀 훅 예시
function myContext(): TurnStartHook {
  return {
    name: 'my-context',
    async execute(ctx) {
      return [{ source: 'custom:my-api', role: 'context', content: await fetchData() }]
    },
  }
}
```

### 런타임

런타임은 LLM SDK를 래핑하여 통일된 이벤트 스트림(`RuntimeEvent`)을 제공한다. 한 줄만 바꾸면 런타임을 교체할 수 있다.

```ts
runtime: claudeRuntime({ model: 'claude-sonnet-4-5', apiKey: env('ANTHROPIC_API_KEY') }),
// runtime: codexRuntime({ model: 'gpt-5.4', apiKey: env('CODEX_API_KEY') }),
```

### 커넥터

커넥터는 외부 플랫폼과의 양방향 어댑터다. 선택 사항이며, 없으면 `agent.processTurn()`으로 직접 실행할 수 있다.

### 스케줄

cron 표현식 또는 고정 간격(heartbeat)으로 턴을 자동 트리거한다. 스케줄 설정은 서버 재시작 없이 핫리로드된다.

### 워크스페이스 컨텍스트 (`.sena/`)

에이전트의 성격과 지식을 파일 기반으로 관리한다. `fileContext` 훅으로 시스템 프롬프트에 자동 주입.

| 파일 | 용도 |
|------|------|
| `AGENTS.md` | 에이전트 행동 지침 |
| `SOUL.md` | 에이전트 성격/페르소나 |
| `IDENTITY.md` | 정체성 정의 |
| `USER.md` | 사용자 정보 |
| `TOOLS.md` | 도구 사용 가이드 |
| `memory/` | 장기 기억 |
| `HEARTBEAT.md` | 하트비트 실행 지침 |

## 런타임 이벤트

| 이벤트 | 의미 |
|--------|------|
| `session.init` | 세션 ID 확정 |
| `progress` | 어시스턴트 응답 텍스트 (누적) |
| `progress.delta` | 토큰 단위 스트리밍 (증분) |
| `tool.start` | 도구 호출 시작 |
| `tool.end` | 도구 호출 완료 |
| `result` | 최종 응답 |
| `error` | 에러 |

## 커넥터 없이 로컬 실행

```ts
import { createAgent, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { fileContext } from '@sena-ai/hooks'

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

## 라이선스

MIT
