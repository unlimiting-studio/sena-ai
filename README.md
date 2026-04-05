# Sena AI

설정 중심 AI 에이전트 프레임워크 모노레포입니다. `sena.config.ts` 하나로 런타임, 커넥터, 도구, 훅, 스케줄, 오케스트레이터를 조립하고, `sena` CLI로 로컬 운영과 템플릿 부트스트랩을 처리합니다.

## 핵심 기능

- `defineConfig()` 기반의 config-driven 에이전트 구성
- `@sena-ai/runtime-claude`, `@sena-ai/runtime-codex` 런타임 교체
- Slack 직접 연동과 플랫폼 릴레이 연동 지원
- 인라인 도구, MCP 도구, Slack 도구 번들 지원
- `start`, `stop`, `restart`, `status`, `logs`, `init` CLI 제공
- 워커 기반 실행, rolling restart, 세션 유지, 스케줄 실행 지원
- 모든 패키지에 `specs/`를 두는 스펙 중심 개발 방식

## 요구 사항

- Node.js `>= 22`
- `pnpm`
- ESM 기반 TypeScript 실행 환경

## 빠른 시작

### 템플릿으로 새 프로젝트 만들기

기본 템플릿은 Slack 직접 연동입니다.

```bash
pnpm dlx @sena-ai/cli init my-bot
cd my-bot
```

다른 템플릿을 고르려면 `--template`을 사용합니다.

```bash
pnpm dlx @sena-ai/cli init my-bot --template slack-integration
pnpm dlx @sena-ai/cli init my-bot --template platform-integration
```

`sena init`은 다음 작업을 자동으로 수행합니다.

- 템플릿 다운로드
- `%%BOT_NAME%%` 플레이스홀더 치환
- `.env.template`을 `.env`로 변경
- `pnpm install` 실행

생성된 프로젝트에서 `.env`를 채우고 실행하면 됩니다.

```bash
npx sena start
```

기본 설정 파일 경로는 `sena.config.ts`이고, 기본 포트는 `3100`입니다. CLI는 시작 시 현재 작업 디렉터리의 `.env`를 자동으로 로드합니다.

### Slack 템플릿 예시

`slack-integration` 템플릿은 Socket Mode 기반으로 생성됩니다. 공인 엔드포인트가 불필요하므로 로컬이나 방화벽 뒤 환경에서도 바로 실행할 수 있습니다.

```ts
import { defineConfig, env, cronSchedule, heartbeat } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector, slackTools } from '@sena-ai/slack'
import { fileContextHook, currentTimeHook } from '@sena-ai/hooks'

export default defineConfig({
  name: 'my-bot',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-6',
  }),

  connectors: [
    slackConnector({
      mode: 'socket',
      appId: env('SLACK_APP_ID'),
      appToken: env('SLACK_APP_TOKEN'),
      botToken: env('SLACK_BOT_TOKEN'),
    }),
  ],

  tools: [...slackTools({ botToken: env('SLACK_BOT_TOKEN') })],

  hooks: {
    onTurnStart: [
      fileContextHook({ as: 'system', path: 'prompts/SYSTEM.md' }),
      currentTimeHook({ timezone: 'Asia/Seoul' }),
    ],
  },

  schedules: [
    heartbeat('30m', { name: 'channel-watch', prompt: '채널을 확인하세요.' }),
  ],
})
```

필요한 환경 변수:

```env
SLACK_APP_ID=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
```

> HTTP Mode를 사용하려면 `mode: 'socket'`과 `appToken`을 `signingSecret`으로 바꿉니다.

### 플랫폼 릴레이 템플릿 예시

`platform-integration` 템플릿은 Slack 토큰을 로컬 런타임에 두지 않고 플랫폼을 경유합니다.

```ts
import { defineConfig, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { platformConnector } from '@sena-ai/platform-connector'

export default defineConfig({
  name: 'my-bot',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-20250514',
  }),

  connectors: [
    platformConnector({
      platformUrl: env('PLATFORM_URL'),
      connectKey: env('CONNECT_KEY'),
    }),
  ],
})
```

필요한 환경 변수:

```env
CONNECT_KEY=
PLATFORM_URL=
```

## 라이브러리로 직접 조립하기

템플릿 없이 원하는 패키지만 골라 직접 조립할 수도 있습니다.

```bash
pnpm add @sena-ai/core @sena-ai/hooks @sena-ai/tools @sena-ai/runtime-claude
```

Slack 직접 연동이 필요하면 편의 번들인 `@sena-ai/slack`을 추가합니다.

```bash
pnpm add @sena-ai/cli @sena-ai/slack
```

최소 조립 예시는 다음과 같습니다.

```ts
import { createAgent, defineConfig, defineTool, heartbeat } from '@sena-ai/core'
import { fileContextHook, traceLoggerHook } from '@sena-ai/hooks'
import { mcpServer } from '@sena-ai/tools'
import { claudeRuntime } from '@sena-ai/runtime-claude'

const config = defineConfig({
  name: 'demo-agent',
  runtime: claudeRuntime({
    model: 'claude-sonnet-4-6',
  }),
  tools: [
    defineTool({
      name: 'ping',
      description: 'Return pong',
      handler: async () => 'pong',
    }),
    mcpServer({
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    }),
  ],
  hooks: {
    onTurnStart: [
      fileContextHook({ path: './AGENTS.md', as: 'system' }),
    ],
    onTurnEnd: [
      traceLoggerHook({ dir: './traces' }),
    ],
  },
  schedules: [
    heartbeat('1h', { name: 'heartbeat', prompt: '현재 상태를 점검해 요약하세요.' }),
  ],
})

const agent = createAgent(config)
const trace = await agent.processTurn({ input: '지금 상태를 요약해줘' })

console.log(trace.result?.text)
```

## CLI

| 명령 | 설명 |
| --- | --- |
| `sena init <name>` | 새 프로젝트 생성. 템플릿 다운로드, 치환, 의존성 설치 포함 |
| `sena start` | 포그라운드에서 오케스트레이터 실행 |
| `sena start -d` | 백그라운드 데몬 모드 실행. 로그는 `sena.log`에 기록 |
| `sena stop` | 실행 중인 프로세스에 `SIGTERM`, 필요 시 `SIGKILL` |
| `sena restart` | 워커 rolling restart |
| `sena restart --full` | 전체 프로세스 재시작 |
| `sena status` | PID와 `/health` 상태 확인 |
| `sena logs` | `sena.log` 조회 |

CLI는 현재 작업 디렉터리에 `.sena.pid`와 `sena.log`를 사용합니다.

## 아키텍처

```text
Connector / Schedule / Programmatic Call
  -> TurnEngine
     -> onTurnStart hooks
     -> Runtime.createStream()
        -> inline tools / MCP tools
     -> onTurnEnd / onError hooks
  -> Connector output

Orchestrator
  -> Worker child process
     -> HTTP server
     -> Session store
     -> Scheduler
     -> Pending message queue
```

핵심 동작은 다음과 같습니다.

- 같은 대화의 동시 입력은 워커가 큐잉해 순서를 보존합니다.
- 워커는 도구 경계에서 pending message를 steer로 주입할 수 있습니다.
- 세션 스토어를 통해 `conversationId -> sessionId`를 유지합니다.
- 오케스트레이터는 새 워커가 ready 된 뒤에만 트래픽을 전환합니다.
- 스케줄은 `cronSchedule()`과 `heartbeat()`로 정의하고 동일 스케줄의 중복 실행을 막습니다.

## 패키지 구성

| 패키지 | 역할 |
| --- | --- |
| `@sena-ai/core` | 설정 정규화, 턴 엔진, 워커, 오케스트레이터, 스케줄, 도구 계약 |
| `@sena-ai/hooks` | `fileContext`, `traceLogger` 같은 기본 훅 |
| `@sena-ai/tools` | 외부 MCP 서버를 연결하는 `mcpServer()` |
| `@sena-ai/cli` | 프로젝트 초기화와 에이전트 운영 CLI |
| `@sena-ai/runtime-claude` | Claude Agent SDK 기반 런타임 |
| `@sena-ai/runtime-codex` | Codex CLI App Server 기반 런타임 |
| `@sena-ai/slack-mrkdwn` | Slack safe-mode Markdown 변환 공용 패키지 |
| `@sena-ai/connector-slack` | Slack Events API / Socket Mode 커넥터 |
| `@sena-ai/tools-slack` | Slack 메시지, 채널, 파일, 사용자 도구 모음 |
| `@sena-ai/slack` | Slack 커넥터와 도구 번들 |
| `@sena-ai/platform-connector` | 플랫폼 릴레이를 통한 로컬 런타임 연결 |
| `@sena-ai/platform-core` | 멀티테넌트 플랫폼 코어 라이브러리 |
| `@sena-ai/platform-node` | Node.js 기반 플랫폼 서버 진입점, MySQL 조합 패키지 |
| `@sena-ai/platform-worker` | Cloudflare Workers 기반 플랫폼 배포 패키지 |

`@sena-ai/platform-node`와 `@sena-ai/platform-worker`는 현재 애플리케이션 배포용 패키지로 운영되며, 일반 라이브러리 패키지처럼 배포해 쓰는 용도와는 결이 다릅니다.

## 런타임과 도구

### 런타임

- `@sena-ai/runtime-claude`
  - Claude Agent SDK를 Sena `Runtime` 계약에 맞춰 감쌉니다.
  - 인라인 도구와 외부 MCP 도구를 함께 사용할 수 있습니다.
  - 세션 재개, steer, abort 흐름을 지원합니다.
- `@sena-ai/runtime-codex`
  - Codex CLI App Server를 Sena `Runtime` 계약에 연결합니다.
  - 인라인 MCP HTTP 서버와 MCP 서버 오버라이드를 구성합니다.
  - approval policy, sandbox mode, reasoning effort 옵션을 제공합니다.
  - 기본적으로 공식 `@openai/codex` 패키지가 제공하는 managed executable을 사용하고, 필요할 때만 `codexBin`으로 override 합니다.

### 도구

- 인라인 도구는 `defineTool()`로 정의합니다.
- 외부 MCP 도구는 `mcpServer()`로 연결합니다.
- Slack 작업이 많으면 `slackTools()` 또는 `@sena-ai/slack` 번들을 사용합니다.
- 도구 결과는 `toolResult()`로 멀티모달 콘텐츠를 반환할 수 있습니다.

## 스펙 중심 개발

이 저장소의 모든 패키지는 자체 `specs/` 디렉터리를 가집니다.

```text
packages/<package>/specs/
  index.md
  <responsibility>.md
```

원칙은 단순합니다.

- 동작을 바꾸는 작업은 스펙을 먼저 수정합니다.
- 상위 스펙 `index.md`와 상세 스펙 사이의 traceability를 유지합니다.
- 구현은 freeze 된 스펙을 기준으로 진행합니다.

대표 예시:

- `packages/core/specs/`
- `packages/cli/specs/`
- `packages/runtime/claude/specs/`
- `packages/runtime/codex/specs/`
- `packages/integrations/slack/connector/specs/`
- `packages/platform/core/specs/`

## 저장소 구조

```text
sena-ai/
├── packages/
│   ├── cli/
│   ├── core/
│   ├── hooks/
│   ├── tools/
│   ├── runtime/
│   │   ├── claude/
│   │   └── codex/
│   ├── integrations/
│   │   └── slack/
│   │       ├── bundle/
│   │       ├── connector/
│   │       └── tools/
│   └── platform/
│       ├── connector/
│       ├── core/
│       ├── runtime-node/
│       └── runtime-worker/
├── templates/
│   ├── platform-integration/
│   └── slack-integration/
├── package.json
├── pnpm-workspace.yaml
└── vitest.config.ts
```

## 개발

```bash
git clone https://github.com/unlimiting-studio/sena-ai
cd sena-ai
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

테스트는 `packages/**/src/**/*.test.ts` 패턴을 기준으로 실행됩니다.
