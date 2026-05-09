# @sena-ai/app

sena-ai v3 앱 레이어. ai-sdk + chat-sdk + state-pg + claude-code/codex-cli 위에 Slack mention turn, 정기 발화, 방향 전환, 안전한 종료, 채널별 기억을 한 프로세스에서 처리하는 얇은 래퍼예요.

**상태:** 0.1.0 — Slack 운영형 에이전트 1차 실행 가능 상태

## 설치

```bash
pnpm add @sena-ai/app ai chat @chat-adapter/slack @chat-adapter/state-pg \
  ai-sdk-provider-claude-code
```

## 바로 실행 가능한 구성

```ts
import { defineConfig, requiredEnv, run } from "@sena-ai/app";
import { slackAdapter } from "@sena-ai/app/adapters/slack";
import { channelContext, traceLogger } from "@sena-ai/app/middlewares";
import { cronSchedule } from "@sena-ai/app/schedules";
import { postgresState } from "@sena-ai/app/state";
import { claudeCode } from "ai-sdk-provider-claude-code";

const config = defineConfig({
  cwd: import.meta.dirname,
  model: claudeCode("sonnet"),
  adapters: [
    slackAdapter({
      appToken: requiredEnv("SLACK_APP_TOKEN"),
      botToken: requiredEnv("SLACK_BOT_TOKEN"),
    }),
  ],
  middlewares: [
    channelContext({
      cwd: import.meta.dirname,
      channelsFile: ".sena/channels.json",
      memoryDir: ".sena/channels",
    }),
    traceLogger({ label: "sena" }),
  ],
  schedules: [
    cronSchedule({
      name: "morning-briefing",
      cron: "0 8 * * *",
      target: { type: "slack-channel", id: "C0YOURCHANNEL" },
      prompt: { file: ".sena/prompts/morning-briefing.md" },
    }),
  ],
  state: postgresState({ connectionString: requiredEnv("DATABASE_URL") }),
});

const app = await run(config);
process.once("SIGTERM", () => void app.shutdown().then(() => process.exit(0)));
```

## 제공하는 것

| 영역 | 상태 |
|---|---|
| Slack Socket Mode adapter helper | ✅ `slackAdapter()` |
| Postgres / memory state helper | ✅ `postgresState()`, `createMemoryState()` |
| 채널별 기억 합성 | ✅ `channelContext()` |
| API 연동 tools | ✅ `defineConfig({ tools, maxSteps })` |
| 정기 발화 | ✅ `cronSchedule()` + node-cron fan-out |
| 방향 전환 | ✅ queue / immediate steering / step-steering |
| 안전한 종료 | ✅ in-flight drain 후 chat shutdown |
| 외부 reference 출력 보호 | ✅ stream 불가 상황은 string post로 전환 |
| MCP 서버 연결 | 🚧 설정을 받으면 fail-fast. provider 병합 단계에서 연결 예정 |

## 템플릿

`templates/slack-agent`에 `.env.example`, `src/index.ts`, `.sena/channels.json`, 정기 발화 프롬프트까지 들어간 운영형 시작 템플릿이 있어요.
