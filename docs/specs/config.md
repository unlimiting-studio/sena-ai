# `sena.config.ts` Interface

## 한 줄

`defineConfig({ model, adapters, middlewares, schedules, state, mcpServers, cwd })` — chat-sdk `Chat` 인스턴스를 만드는 헬퍼에 가까운 한 함수.

## 1차 가설 (시그니처 변경 가능)

```ts
import { defineConfig } from '@sena-ai/app';
import { slackAdapter } from '@sena-ai/app/adapters/slack';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { channelContext } from '@sena-ai/app/middlewares/channel-context';
import { traceLogger } from '@sena-ai/app/middlewares/trace';
import { cronSchedule } from '@sena-ai/app/schedules';

export default defineConfig({
  cwd: import.meta.dirname,

  // LLM provider — 모델·reasoning 설정은 cc/codex 시스템 설정에 위임
  model: claudeCode({ /* provider 옵션만 */ }),
  // model: codexCli({ sandboxMode: 'workspace-write' }),

  // chat-sdk 어댑터 (1차에서는 Slack 하나)
  adapters: [
    slackAdapter({
      botToken: process.env.SLACK_BOT_TOKEN!,
      appToken: process.env.SLACK_APP_TOKEN!,
      // trigger 라우팅(mention/thread/reaction/...)은 어댑터 표준 동작
    }),
  ],

  // ai-sdk LanguageModelV3Middleware 배열. 순서대로 wrapLanguageModel
  middlewares: [
    channelContext({ channelsFile: '.sena/channels.json', memoryDir: '.sena/channels' }),
    traceLogger({ stream: process.stdout }),
  ],

  // cron 트리거. 우리가 직접 짠다 (chat-sdk ScheduledMessage는 미래 발송 1-shot이라 cron 의미 없음 — PoC 확정).
  schedules: [
    cronSchedule({
      cron: '0 8 * * *',
      target: { type: 'slack-channel', id: 'C0AFW...' }, // briefing 채널
      prompt: { file: '.sena/prompts/morning-briefing.md' },
    }),
  ],

  // chat-sdk state adapter — '@chat-adapter/state-pg' 확정 (PoC 0단계에서 검증)
  state: {
    type: 'pg',
    connectionString: process.env.DATABASE_URL!,
  },

  // MCP 서버 1급
  mcpServers: {
    fs: { type: 'stdio', command: 'mcp-server-filesystem', args: ['/path'] },
    // ...
  },
});
```

## 옵션 별 의미

| 옵션          | 타입                                               | 출처              | 비고                                                                 |
| ------------- | -------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| `cwd`         | `string`                                           | sena              | `prompt: { file }` 등 파일 경로 baseDir. 기본값 `process.cwd()`.       |
| `model`       | `LanguageModelV3` (ai-sdk)                         | provider 패키지   | claude-code / codex-cli provider가 반환하는 LanguageModel.             |
| `adapters`    | `ChatAdapter[]` (chat-sdk)                         | `@chat-adapter/*` | 여러 어댑터 병렬 등록 가능 (multi-connector, FR-10).                   |
| `middlewares` | `LanguageModelV3Middleware[]` (ai-sdk)             | sena + 사용자     | `wrapLanguageModel` 순서로 적용. `docs/specs/hooks.md` 참조.           |
| `schedules`   | `Schedule[]`                                       | sena              | `docs/specs/schedules.md` 참조.                                       |
| `state`       | chat-sdk `StateAdapter`                            | `@chat-adapter/state-pg` | 확정. PoC 0단계에서 실 동작 검증.                                       |
| `mcpServers`  | `Record<string, McpServerConfig>`                  | 사용자            | `docs/specs/tools.md` 참조.                                           |

## 검증 결과 (rev. 2)

- ✅ chat-sdk `Chat` 인스턴스를 `defineConfig` 내부에서 만드는 구조 그대로. 어댑터/state/concurrency를 합쳐서 `new Chat({...})` 호출.
- ✅ middleware는 ai-sdk `LanguageModelV3Middleware` 한 종만 사용 (`wrapLanguageModel`). chat-sdk가 별도 핸들러 미들웨어 hook을 노출하지 않으므로 분리 불필요.
- ✅ cron은 `schedules` 배열로 받고 우리가 직접 트리거 (`docs/specs/schedules.md`). chat-sdk `ScheduledMessage`는 미래 발송 1-shot이라 cron과 별개.

## AC

1. 1차 PoC 에이전트의 `sena.config.ts`가 위 시그니처로 작성되고, `pnpm tsc --noEmit`이 통과한다.
2. `model`을 `claudeCode()` ↔ `codexCli()` 사이에서 한 줄로 교체할 수 있다.
3. v2의 `defineConfig` 시그니처에서 1:1 자동 마이그가 어려운 항목(예: hook 시그니처)은 `migration.md`에 매핑 표로 명시되어 있다.
