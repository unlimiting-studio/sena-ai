# Sena

Karby의 Slack/GitHub 연동 에이전트를 **Claude Agent SDK 중심으로 재작성**해 분리한 서버 프로젝트입니다.

## 실행

```bash
pnpm install
pnpm dev
```

## 환경 변수(예시)

최소한 아래 값이 필요합니다.

- `PORT`
- `BACKEND_URL`
- `SLACK_APP_ID`
- `SLACK_TOKEN`
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY` (base64, 32바이트 권장)
