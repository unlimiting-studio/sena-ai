# `sena.config.ts` Interface

**상태:** rev. 3 (step 4.6 cbc0208 — starter runnable / factory wrapper / channelContext 옵션 / state 객체 폼 반영).

## 한 줄

`defineConfig({ model, adapters, middlewares, schedules, state, tools, maxSteps, mcpServers, cwd })` — chat-sdk `Chat` 인스턴스를 만드는 헬퍼에 가까운 한 함수. 실제 인스턴스화는 `run()` 이 담당하며, `defineConfig` 는 기본값만 채워서 `SenaConfig` 를 반환한다.

## 시그니처 (cbc0208 코드 기준)

```ts
import { defineConfig, requiredEnv, run } from '@sena-ai/app';
import { slackAdapter } from '@sena-ai/app/adapters/slack';
import { channelContext, traceLogger } from '@sena-ai/app/middlewares';
import { cronSchedule } from '@sena-ai/app/schedules';
import { postgresState } from '@sena-ai/app/state';
import { claudeCode } from 'ai-sdk-provider-claude-code';

const config = defineConfig({
  cwd: import.meta.dirname,

  // LLM provider
  model: claudeCode('sonnet'),

  // chat-sdk 어댑터 (1차 Slack 하나)
  adapters: [
    slackAdapter({
      appToken: requiredEnv('SLACK_APP_TOKEN'),
      botToken: requiredEnv('SLACK_BOT_TOKEN'),
    }),
  ],

  // ai-sdk LanguageModelV3Middleware 배열. 순서대로 wrapLanguageModel.
  middlewares: [
    channelContext({
      cwd: import.meta.dirname,
      channelsFile: '.sena/channels.json',
      memoryDir: '.sena/channels',
    }),
    traceLogger({ label: 'sena' }),
  ],

  // ai-sdk ToolSet — `streamText({ tools })` 로 그대로 전달. `docs/specs/tools.md` 참조.
  tools: {
    // createInvoice, lookupCustomer, ... (ai-sdk `tool({...})`)
  },
  maxSteps: 5,

  // cron 트리거. 우리가 직접 짠다 (chat-sdk ScheduledMessage 흡수 안 함).
  schedules: [
    cronSchedule({
      name: 'morning-briefing',
      cron: '0 8 * * *',
      target: { type: 'slack-channel', id: 'C0AFW...' },
      prompt: { file: '.sena/prompts/morning-briefing.md' },
    }),
  ],

  // state — adapter 객체를 직접 넘기거나, 짧은 설정 객체로 전달.
  state: postgresState({ connectionString: requiredEnv('DATABASE_URL') }),

  // MCP 서버 — 0.1.x 에서는 fail-fast (`run()` 진입 시 throw). step 5+ 에서 provider 병합.
  // mcpServers: { fs: { type: 'stdio', command: 'mcp-server-filesystem', args: ['/path'] } },
});

const app = await run(config, { steerMode: 'steering' });
```

## Factory wrapper 시그니처 (코드 기준)

> 모두 `@sena-ai/app` 가 외부 SDK 위에 얇게 입힌 wrapper. 사용자가 외부 객체를 직접 넘기는 경로도 그대로 열려 있다.

| Factory             | export                                  | 시그니처                                                                                         |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `slackAdapter`      | `@sena-ai/app/adapters/slack`           | `slackAdapter(options?: SenaSlackAdapterOptions = {}) → SlackAdapter`                            |
| `postgresState`     | `@sena-ai/app/state`                    | `postgresState(options?: PostgresStateOptions = {}) → PostgresStateAdapter`                       |
| `createMemoryState` | `@sena-ai/app/state`                    | `createMemoryState() → MemoryStateAdapter` (re-export of `@chat-adapter/state-memory`)            |
| `requiredEnv`       | `@sena-ai/app`                          | `requiredEnv(name: string): string` — 빈 값/미정의 시 `Error("Missing required env: ...")` throw |
| `channelContext`    | `@sena-ai/app/middlewares`              | `channelContext(options: ChannelContextOptions): LanguageModelMiddleware`                         |
| `traceLogger`       | `@sena-ai/app/middlewares`              | `traceLogger(options?: TraceLoggerOptions = {}): LanguageModelMiddleware`                         |
| `cronSchedule`      | `@sena-ai/app/schedules`                | `cronSchedule(spec: CronScheduleSpec): Schedule` — `docs/specs/schedules.md` 참조                  |

### `slackAdapter` 디폴트

`SenaSlackAdapterOptions = Partial<SlackAdapterConfig> & { mode?: SlackAdapterMode }`. 본 wrapper 는 `mode` 미지정 시 `'socket'` 으로 강제 (API key 만으로 로컬/운영을 띄울 수 있게 — public webhook 우선 요구 회피).

### `postgresState` 디폴트

```ts
export type PostgresStateOptions = CreatePostgresStateOptions & {
  /** Alias for `url`, matching common DATABASE_URL naming. */
  connectionString?: string;
};
```

- `client` 가 들어오면 그대로 위임.
- 그 외에는 `url` ?? `connectionString` ?? `process.env.DATABASE_URL` 순으로 해석. 셋 다 없으면 `Error("postgresState requires url/connectionString or DATABASE_URL")` throw.

### `traceLogger` 디폴트

```ts
export interface TraceLoggerOptions {
  /** 로그 prefix. 기본 `sena` */
  label?: string;
  /** 로그 stream. 기본 `process.stdout` */
  stream?: NodeJS.WritableStream;
}
```

PoC 의 `traceLogger("label")` 위치 인자에서 `traceLogger({ label })` 객체 옵션으로 변경됨 (rev. 2 → rev. 3, cbc0208).

### `channelContext` 옵션

```ts
export interface ChannelContextOptions {
  channelsFile: string;
  memoryDir: string;
  cwd?: string;
  /** channels.json 부재 허용 (개발 모드용). 운영 기본값은 false. */
  optional?: boolean;
}
```

- `cwd` 미지정 시 `process.cwd()` 사용 — starter 는 `import.meta.dirname` 을 명시 권장.
- `optional: true` 일 때만 `channels.json` 미존재(ENOENT) 가 silent skip. 운영에서는 누락 시 turn 진입 자체가 fail-fast (`docs/specs/hooks.md` turn-context 절 참조).

## 옵션 표 (코드 기준)

| 옵션          | 타입 (코드)                                          | 기본값 (`defineConfig`)        | 비고                                                                                  |
| ------------- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| `cwd`         | `string`                                             | `process.cwd()`                | `prompt: { file }` 등 baseDir.                                                         |
| `model`       | `LanguageModelV3` (ai-sdk)                           | (필수)                         | 입력 그대로 보존. `wrapLanguageModel` 은 `run()` 에서.                                  |
| `adapters`    | `Adapter[]` (chat)                                   | (필수, 0개면 fail-fast)        | `run()` 진입 시 `Adapter[]` → `Record<name, Adapter>` 로 변환. 이름 중복 시 throw.       |
| `middlewares` | `LanguageModelMiddleware[]` (ai)                     | `[]`                           | `run()` 에서 비어있지 않으면 `wrapLanguageModel` 적용.                                  |
| `tools`       | `ToolSet` (ai)                                       | `undefined`                    | 비면 `streamText` 가 tool 없이 호출 (`stopWhen` 도 미적용).                              |
| `maxSteps`    | `number`                                             | `undefined` (런타임 폴백 5)    | `tools` 가 있을 때만 `stopWhen: stepCountIs(maxSteps)` 적용.                            |
| `schedules`   | `Schedule[]`                                         | `[]`                           | `setupScheduleFanOut` 으로 등록. `docs/specs/schedules.md` 참조.                        |
| `state`       | `StateInput = StateAdapter \| PostgresStateConfig \| MemoryStateConfig` | (필수) | `run()` 진입 시 `resolveStateAdapter` 가 분기.                                       |
| `mcpServers`  | `Record<string, McpServerConfig>`                    | `undefined`                    | step 4.x 에서는 `run()` 이 fail-fast. step 5+ 에서 provider 병합.                       |

### `StateInput` 객체 폼 (cbc0208 신규)

```ts
export interface PostgresStateConfig {
  type: 'pg';
  /** Alias names — DATABASE_URL 직접 매핑용 */
  url?: string;
  connectionString?: string;
  keyPrefix?: string;
  logger?: Logger;
}

export interface MemoryStateConfig {
  type: 'memory';
}

export type StateInput = StateAdapter | PostgresStateConfig | MemoryStateConfig;
```

`run()` 내부 `resolveStateAdapter(input)`:

- 이미 `StateAdapter` 면(connect/disconnect/subscribe/unsubscribe/acquireLock/releaseLock 메서드 보유) 그대로 사용.
- `{ type: 'memory' }` → `createMemoryState()`.
- `{ type: 'pg', ... }` → `url` ?? `connectionString` ?? `process.env.DATABASE_URL` 해석 후 `createPostgresState({ ...rest, url })`. 셋 다 없으면 throw.

> 이 분기는 `postgresState()` factory 와 별개 경로. starter 는 factory (`postgresState({...})`) 로 어댑터 객체를 직접 만들고, 짧게 쓰고 싶은 호출자는 `state: { type: 'pg' }` 객체 폼을 쓰는 두 인터페이스가 모두 지원된다.

## `defineConfig` 동작

`SenaConfigInput = Partial<SenaConfig> & Pick<SenaConfig, 'model' | 'adapters' | 'state'>`. 즉 `model`/`adapters`/`state` 는 입력 필수, 나머지는 옵셔널이며 다음 기본값이 적용된다:

- `cwd ?? process.cwd()`
- `middlewares ?? []`
- `schedules ?? []`
- `tools` / `maxSteps` / `mcpServers` 는 미지정 시 `undefined` 로 보존 (런타임 폴백은 `run()` 책임)

`defineConfig` 는 chat-sdk Chat 인스턴스를 만들지 *않는다*. 단순히 `SenaConfig` 객체로 정규화만 하고, 실제 `new Chat({...})` 호출은 `run()` 안에서 이루어진다 — `docs/specs/architecture.md` "통합 entry (`run()`)" 절 참조.

## 검증 결과 (rev. 3)

- ✅ chat-sdk `Chat` 인스턴스화는 `run()` 으로 이동. `defineConfig` 는 정규화 함수.
- ✅ `tools` / `maxSteps` 가 정식 옵션으로 추가. `tools` 가 있는 turn 만 `stopWhen: stepCountIs(maxSteps)` 적용 (`docs/specs/tools.md` 참조).
- ✅ middleware 는 ai-sdk `LanguageModelV3Middleware` 한 종만 (`wrapLanguageModel`). chat-sdk 는 별도 핸들러 미들웨어 hook 미노출.
- ✅ `state` 는 어댑터 객체 또는 `{ type: 'pg' | 'memory' }` 객체 폼 둘 다 허용 — `resolveStateAdapter` 가 분기.
- ✅ `mcpServers` / `adapters: []` 는 `run()` 진입 시 fail-fast.

## AC

1. starter (`templates/slack-agent/src/index.ts`) 가 위 시그니처 그대로 작성되고, `pnpm tsc --noEmit` 이 통과한다.
2. `model` 을 `claudeCode('sonnet')` ↔ `codexCli({...})` 사이에서 한 줄로 교체할 수 있다.
3. `state` 를 `postgresState({...})` ↔ `{ type: 'pg', url }` ↔ `{ type: 'memory' }` 사이에서 객체만 바꿔 교체할 수 있다.
4. v2 의 `defineConfig` 시그니처에서 1:1 자동 마이그가 어려운 항목(예: hook 시그니처)은 `migration.md` 매핑 표로 명시된다.
