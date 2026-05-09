# Sena Slack Agent Starter

이 템플릿은 Slack Socket Mode, Postgres 상태 저장, 채널별 기억, 아침 브리핑 cron까지 켜진 최소 운영형 에이전트예요.

## 실행

```bash
cp .env.example .env
pnpm install
pnpm start
```

채워야 하는 값은 `SLACK_APP_TOKEN`, `SLACK_BOT_TOKEN`, `DATABASE_URL` 세 가지예요. 모델 provider 키나 CLI 로그인은 선택한 provider 패키지 규칙을 따릅니다.

## 바꿀 곳

- `src/index.ts`의 `model`
- `.sena/channels.json`의 Slack 채널 ID
- `.sena/prompts/morning-briefing.md`의 정기 발화 지시문
- `.sena/channels/<채널ID>/memory.md`의 채널별 운영 메모
