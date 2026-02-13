# Sena

Karby의 Slack/GitHub 연동 에이전트를 분리한 서버 프로젝트입니다. 런타임은 `Claude Agent SDK`와 `Codex SDK`를 실행 옵션으로 전환할 수 있습니다.

## 실행

```bash
pnpm install
pnpm dev
```

## 환경 변수(예시)

최소한 아래 값이 필요합니다.

- `PORT`
- `BACKEND_URL`
- `AGENT_RUNTIME_MODE` (`claude`|`codex`, 기본값: `claude`)
- `AGENT_MODEL` (선택, 미설정 시 모드별 기본 모델 사용)
- `SLACK_APP_ID`
- `SLACK_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_VERIFY_MODE` (agent|external)
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY` (base64, 32바이트 권장)
- `SENA_CONFIG_PATH` (선택, `sena.yaml`/`sena.jsonc` 절대·상대 경로를 명시하고 싶을 때)

### Claude 모드(`AGENT_RUNTIME_MODE=claude`)

- `ANTHROPIC_API_KEY`

### Codex 모드(`AGENT_RUNTIME_MODE=codex`)

- `CODEX_API_KEY` (또는 `OPENAI_API_KEY`)
- `OPENAI_BASE_URL` (선택)
- `sena.yaml`에 정의한 MCP 서버 + `context7`를 사용합니다.
- 추가로 런타임에서 `slack` MCP가 자동 주입되며, CouchDB 설정이 있으면 `obsidian` MCP도 자동 주입됩니다.

## `sena.yaml` 런타임 설정

- `runtime.mode`에 `claude` 또는 `codex`를 넣어 기본 런타임 모드를 설정할 수 있습니다.
- `runtime.model`로 기본 모델을 설정할 수 있습니다.
- 동일 값이 환경 변수(`AGENT_RUNTIME_MODE`, `AGENT_MODEL`)에 있으면 환경 변수가 우선합니다.

## `sena.yaml` 스케줄 설정(옵셔널)

- `cronjobs`: cron 표현식(5필드) 기준으로 주기 작업을 실행합니다.
- `heartbeat`: `intervalMinute` 단위(분)로 주기 작업을 실행합니다.

예시:

```yaml
cronjobs:
  - expr: 0 * * * *
    name: 정각 알림
    prompt: |
      당신은 지금 해야하는 일을 수행합니다. DO_EVERY_HOUR.md 파일을 참고하세요
heartbeat:
  intervalMinute: 15
  prompt: |
    당신은 HEARTBEAT.md 파일을 읽고 해야 하는 일을 수행하세요
```
