# @sena-ai/app

sena-ai v3 앱 레이어. ai-sdk + chat-sdk + state-pg + claude-code/codex-cli 위에 얹어 — Slack mention turn · cron 발화 · concurrency·인터럽트·graceful shutdown 까지 한 프로세스에서 처리하는 얇은 래퍼.

**상태:** 0.1.0 (skeleton, 본 마이그 §1 첫 단계)

- **PRD:** <https://reports.yechanny.workers.dev/sena-v3-prd/>
- **PoC 보고서:** <https://reports.yechanny.workers.dev/sena-v3-poc-report/>
- **SPEC:** [`../../SPEC.md`](../../SPEC.md)

## 책임

| 영역 | 패키지가 제공 | 외부 위임 |
|---|---|---|
| LanguageModel 추상 / streamText / middleware | — | `ai` |
| Slack 어댑터 / 핸들러 / 출력 | — | `chat` + `@chat-adapter/slack` |
| thread routing / lock / queue 영속 | — | `@chat-adapter/state-pg` |
| LLM 엔진 | — | `ai-sdk-provider-claude-code` / `-codex-cli` |
| **drain wrapper** (`Chat.shutdown` drain 부재 보완) | ✅ | — |
| **steering 레이어** (AbortController 기반 turn abort + 새 컨텍스트 재시작) | ✅ | — |
| **외부 reference stream wrapper** (`Thread.handleStream` 외부 reference 보호) | ✅ | — |
| **abort stream stop swallow** (`chatStream.stop` `not_authed` swallow) | ✅ | — |
| **cronSchedule** (시간 트리거 → `chat.thread()` reference → string post) | ✅ | — |
| **channelContext middleware** (`channels.json` + per-channel `memory.md`) | ✅ | — |
| **traceLogger middleware** (`transformParams` + `wrapStream` chunk count) | ✅ | — |
| inline MCP bridge (provider Zod tool 미지원 우회) | ✅ (별도 모듈) | — |

## 설치

```bash
pnpm add @sena-ai/app ai chat @chat-adapter/slack @chat-adapter/state-pg \
  ai-sdk-provider-claude-code
```

## 사용 (1차 가설 시그니처, `docs/specs/config.md`)

```ts
import { defineConfig } from "@sena-ai/app";
import { createSlackAdapter } from "@chat-adapter/slack";
import { createPostgresState } from "@chat-adapter/state-pg";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { channelContext, traceLogger } from "@sena-ai/app/middlewares";
import { cronSchedule } from "@sena-ai/app/schedules";

export default defineConfig({
  cwd: import.meta.dirname,
  model: claudeCode("sonnet"),
  adapters: [
    createSlackAdapter({
      mode: "socket",
      appToken: process.env.SLACK_APP_TOKEN!,
      botToken: process.env.SLACK_BOT_TOKEN!,
    }),
  ],
  middlewares: [
    channelContext({ channelsFile: ".sena/channels.json", memoryDir: ".sena/channels" }),
    traceLogger({ stream: process.stdout }),
  ],
  schedules: [
    cronSchedule({
      name: "morning-briefing",
      cron: "0 8 * * *",
      target: { type: "slack-channel", id: "C0AN91Z2ZL3" },
      prompt: { file: ".sena/prompts/morning-briefing.md" },
    }),
  ],
  state: createPostgresState({ url: process.env.DATABASE_URL! }),
  mcpServers: {
    fs: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
    },
  },
});
```

## chat-sdk 부수 발견 wrapper (PoC 0단계 발견)

본 패키지가 chat-sdk 4.28.1 / @chat-adapter/slack 4.28.1의 다음 3건을 wrapper로 보완한다:

1. **`Thread.handleStream` 외부 reference에서 깨짐** (`chat/dist/index.js:1631`) — `chat.thread(id)`로 만든 외부 reference에서 stream post 시 `_currentMessage.author.userId` undefined dereference. cron 발화·외부 트리거 시나리오에서 streaming 출력 불가 → wrapper에서 가드 후 fallback string post.
2. **abort 시 `chatStream.stop()` `not_authed`** (`@chat-adapter/slack/dist/index.js:3386`) — abort 직후 stream close 처리가 `not_authed`로 깨짐 → wrapper에서 swallow.
3. **`Chat.shutdown()` drain 부재** (`chat/dist/index.js:2454-2476`) — 어댑터/state disconnect만 하고 in-flight 핸들러 추적 안 함 → 우리 `inFlight` 카운터 + 200ms 폴링 drain 루프(60s timeout) wrapper로 graceful shutdown 보장.

각 항목은 `src/runtime/` 하위 모듈에서 처리한다. 본 마이그 종료 후 chat-sdk upstream PR로 일부 흡수 시도 가능.
