# Sena

Config-driven AI 에이전트 프레임워크.
`sena.config.ts` 하나로 런타임, 커넥터, 도구, 훅, 스케줄을 선언하고, CLI로 제로-다운타임 운영한다.

## 빠른 시작

### 에이전트 프로젝트에서 사용 (라이브러리)

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @sena-ai/core @sena-ai/cli @sena-ai/runtime-claude
# 필요에 따라 추가
npm install @sena-ai/connector-slack @sena-ai/tools-slack @sena-ai/hooks
```

`.env` 파일에 환경 변수 설정:

```env
SLACK_APP_ID=A0XXXXXXXXX
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...          # HTTP mode (기본)
# SLACK_APP_TOKEN=xapp-1-...     # Socket mode (방화벽 뒤 서버용)
```

`sena.config.ts` 작성 후 실행:

```bash
npx sena start        # 포그라운드
npx sena start -d     # 데몬 모드
```

### 프레임워크 개발

```bash
git clone https://github.com/Variel/sena.git
cd sena
pnpm install
pnpm build
```

## 설정 예시

```ts
import { defineConfig, env, heartbeat, cronSchedule } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'
import { fileContext } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-agent',
  cwd: './.context/',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-5',
  }),

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),  // HTTP mode
      // mode: 'socket', appToken: env('SLACK_APP_TOKEN'),  // Socket mode (방화벽 뒤)
      thinkingMessage: ':thinking: 생각 중...',
    }),
  ],

  tools: [
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
  ],

  hooks: {
    onTurnStart: [
      fileContext({ path: './.context/SYSTEM.md', as: 'system' }),
      fileContext({ path: './.context/MEMORY.md', as: 'context' }),
    ],
  },

  schedules: [
    heartbeat('1h', { name: 'heartbeat', prompt: 'HEARTBEAT.md를 읽고 수행하세요' }),
    cronSchedule('0 9 * * 1-5', { name: 'morning', prompt: '오늘의 일정을 정리하세요.' }),
  ],

  orchestrator: { port: 3100 },
})
```

## CLI

```bash
sena start              # 포그라운드 실행
sena start -d           # 데몬 모드 (sena.log에 로그 출력)
sena stop               # 정상 종료 (SIGTERM → 10s → SIGKILL)
sena restart            # 제로-다운타임 워커 교체 (SIGUSR2)
sena restart --full     # 전체 프로세스 재시작
sena status             # PID + health endpoint 확인
sena logs               # tail -f sena.log
```

## 아키텍처

```
Orchestrator (public port)
  └─ Worker (forked child process)
       ├─ HTTP Server
       │    ├─ /health → 200 ok
       │    └─ Connector routes (e.g. POST /api/slack/events)
       ├─ TurnEngine
       │    ├─ onTurnStart hooks → ContextFragment[]
       │    ├─ Runtime.createStream() → stream events
       │    └─ onTurnEnd / onError hooks
       ├─ Scheduler (cron + heartbeat)
       └─ SessionStore (file-backed)
```

외부 플랫폼(Slack 등)에서 이벤트를 수신하면 훅 파이프라인으로 컨텍스트를 조립하고, 런타임으로 LLM을 실행하고, 결과를 다시 외부로 전송한다. 스케줄 태스크도 동일한 파이프라인으로 실행된다.

- **Zero-downtime restart**: `sena restart` → SIGUSR2 → 새 워커 준비 → 트래픽 전환 → 이전 워커 drain
- **Session continuity**: 파일 기반 세션 스토어. Slack 스레드 = 하나의 대화 세션
- **Steer**: 턴 진행 중 새 메시지가 오면 tool boundary에서 기존 턴에 자동 주입

## 패키지 구조

| 패키지 | 역할 |
|--------|------|
| `@sena-ai/core` | 프레임워크 코어 — `defineConfig`, `env`, `createAgent`, `TurnEngine` |
| `@sena-ai/hooks` | 기본 제공 훅 — `fileContext`, `traceLogger`, `cronSchedule`, `heartbeat` |
| `@sena-ai/tools` | 외부 MCP 서버 연결 헬퍼 — `mcpServer` |
| `@sena-ai/cli` | CLI — `start`, `stop`, `restart`, `status`, `logs` |
| **런타임** | |
| `@sena-ai/runtime-claude` | Claude Agent SDK 기반 런타임 |
| `@sena-ai/runtime-codex` | Codex App Server 기반 런타임 |
| **Slack 연동** | |
| `@sena-ai/connector-slack` | Slack 커넥터 — HTTP Events API + Socket Mode 지원 |
| `@sena-ai/tools-slack` | Slack MCP 도구 — 메시지 조회/전송, 파일 업로드/다운로드 |
| `@sena-ai/slack` | connector-slack + tools-slack 번들 re-export |
| **플랫폼** | |
| `@sena-ai/platform-core` | 멀티테넌트 플랫폼 라이브러리 — OAuth, 릴레이, Vault |
| `@sena-ai/platform-connector` | 에이전트→플랫폼 SSE/WS 커넥터 |
| `@sena-ai/platform-node` | Node.js 서버 배포 (MySQL) |
| `@sena-ai/platform-worker` | Cloudflare Workers 배포 (D1) |

```
sena/
├── packages/
│   ├── core/
│   ├── hooks/
│   ├── tools/
│   ├── cli/
│   ├── runtime/
│   │   ├── claude/
│   │   └── codex/
│   ├── integrations/
│   │   └── slack/
│   │       ├── connector/
│   │       ├── tools/
│   │       └── bundle/
│   └── platform/
│       ├── core/
│       ├── connector/
│       ├── runtime-node/
│       └── runtime-worker/
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

자세한 사용법은 [skills/sena-ai/SKILL.md](skills/sena-ai/SKILL.md) 참조.

## 라이선스

MIT
