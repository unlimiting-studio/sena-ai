# 프로젝트 세팅 가이드

## sena init으로 시작하기 (권장)

```bash
pnpm dlx @sena-ai/cli init my-bot
cd my-bot
```

기본 템플릿은 `slack-integration`이다. 다른 템플릿을 쓰려면:

```bash
pnpm dlx @sena-ai/cli init my-bot --template platform-integration
```

`sena init`이 자동으로 수행하는 작업:
- 템플릿 다운로드 (GitHub에서 degit)
- `%%BOT_NAME%%` 플레이스홀더를 프로젝트 이름으로 치환 (`sena.config.ts`, `package.json`, `slack-app-manifest.json`)
- `.env.template` → `.env` 변환
- `pnpm install` 실행

### Slack 앱 등록

생성된 `slack-app-manifest.json`에 봇 이름이 이미 치환되어 있다. 이 파일로 Slack 앱을 만든다:

1. https://api.slack.com/apps → **Create New App** → **From a manifest**
2. 워크스페이스를 선택한다.
3. JSON 탭에서 `slack-app-manifest.json` 내용을 붙여넣고 생성한다.
4. **Basic Information** → **App-Level Tokens** → `connections:write` scope로 토큰 생성 → `xapp-` 접두사 토큰을 `.env`의 `SLACK_APP_TOKEN`에 넣는다.
5. **OAuth & Permissions** → **Install to Workspace** → 설치 후 `xoxb-` 접두사 Bot Token을 `.env`의 `SLACK_BOT_TOKEN`에 넣는다.
6. **Basic Information**에서 App ID를 `.env`의 `SLACK_APP_ID`에 넣는다.

manifest에는 Socket Mode, 필요한 scope, 이벤트 구독이 모두 설정되어 있으므로 별도 설정이 필요 없다.

### 실행

```bash
npx sena start
```

## 수동 세팅 (템플릿 없이)

템플릿 없이 직접 조립할 수도 있다:

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @sena-ai/core @sena-ai/cli @sena-ai/runtime-claude
```

필요에 따라 추가 패키지 설치:

```bash
npm install @sena-ai/slack     # Slack 커넥터 + 도구 번들
npm install @sena-ai/hooks     # 빌트인 훅 (fileContext, traceLogger, currentTime)
```

## .env 설정

Slack Socket Mode 기준:

```env
SLACK_APP_ID=A0XXXXXXXXX
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-1-...
```

HTTP Mode를 사용하는 경우 `SLACK_APP_TOKEN` 대신 `SLACK_SIGNING_SECRET` 사용.

## Minimal Config

```typescript
import { defineConfig } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'

export default defineConfig({
  name: 'my-agent',
  runtime: claudeRuntime({ model: 'claude-sonnet-4-6' }),
})
```

## Slack Connector

### HTTP Mode (기본)

공인 엔드포인트가 있는 서버에서 사용. Slack이 직접 POST 요청을 보낸다.

```typescript
import { slackConnector } from '@sena-ai/connector-slack'

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

### Socket Mode

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

**App-Level Token 발급:**
1. https://api.slack.com/apps → 앱 선택
2. Settings > Basic Information > App-Level Tokens
3. `connections:write` scope로 토큰 생성 → `xapp-` 접두사 토큰 발급

**Slack 앱에서 Socket Mode 활성화:**
1. Settings > Socket Mode → Enable Socket Mode 토글 ON
2. Event Subscriptions는 그대로 유지 (Request URL은 Socket Mode에서 무시됨)

### 모드 선택 기준

| | HTTP Mode | Socket Mode |
|---|---|---|
| 공개 엔드포인트 | 필요 | 불필요 |
| 필요한 키 | `signingSecret` | `appToken` (xapp-…) |
| 방화벽 뒤 | 불가 | 가능 |
| 권장 환경 | 프로덕션 | 로컬, 방화벽 뒤 서버 |

### 타입 정의

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

### 공통 동작

- `app_mention`, `message`, `reaction_added` 이벤트를 처리한다 (봇 메시지, 편집/삭제는 무시).
- 즉시 응답 후 비동기로 턴을 처리한다.
- 스레드 기반 세션: `conversationId = channelId:threadTs`.
- `stop()` 라이프사이클: Socket Mode에서 drain 시 WebSocket을 정상 종료한다.

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

`sena restart`는 오케스트레이터에 SIGUSR2를 보내서 새 워커를 띄우고, 준비되면 트래픽을 전환하고, 이전 워커를 drain한다.

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

## Troubleshooting

| 증상 | 원인 | 해결 |
|---|---|---|
| `EADDRINUSE` | 포트 충돌 | `orchestrator.port`를 변경하거나 기존 프로세스를 종료 |
| Slack 3s timeout 에러 | 이벤트 핸들러가 너무 느림 | 커넥터가 즉시 200을 반환하므로 보통 문제 아님. 로그 확인 |
| 턴이 실행되지 않음 | 세션 스토어 파일 깨짐 | `.sessions.json` 삭제 후 재시작 |
| 크론이 안 도는 것 같음 | 시작 시 즉시 실행 안 됨 | cron은 표현식 매칭 시에만 실행. 즉시 실행이 필요하면 heartbeat 사용 |
| `env()` 에러 | `.env` 파일 누락 또는 키 누락 | `.env` 파일 확인 |
