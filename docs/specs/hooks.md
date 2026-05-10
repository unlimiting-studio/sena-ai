# Hooks (Middleware)

**상태:** rev. 3 (step 4.6 cbc0208 — turn-context AsyncLocalStorage propagation 반영. v2 의 `TurnStart` / `TurnEnd` / `system 합성` 의도 위에 trigger-time channelId/threadId 가 미들웨어까지 전달되는 경로 명시).

## 한 줄

v2 의 `TurnStart` / `TurnEnd` / `system 합성` 의도를 ai-sdk `LanguageModelV3Middleware` 위에 다시 짠다. **함수 시그니처는 v2 와 다르다.** 1:1 자동 마이그 안 됨. trigger-time channelId/threadId 같은 turn 메타는 `runtime/turn-context.ts` AsyncLocalStorage 로 propagate.

## 0 단계 검증 결과 ✅

PoC 에서 `traceLogger` middleware 로 `transformParams` + `wrapStream` 양쪽 라이브 검증. 산출물은 그대로 `packages/app/src/middlewares/trace.ts` 로 이전 (cbc0208 에서 옵션 폼만 객체 인자로 정리 — `traceLogger("label")` → `traceLogger({ label, stream? })`).

```ts
// packages/app/src/middlewares/trace.ts (요지)
export interface TraceLoggerOptions {
  label?: string;                          // 기본 "sena"
  stream?: NodeJS.WritableStream;          // 기본 process.stdout
}

export function traceLogger(options: TraceLoggerOptions = {}): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params, type }) => { /* turn.start type=... */ return params; },
    wrapStream: async ({ doStream, model }) => { /* turn.end + chunk count summary */ },
  };
}
```

**노출 chunk types** (claude-code provider 기준): `stream-start`, `response-metadata`, `reasoning-start`, `reasoning-delta`, `reasoning-end`, `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-call`, `tool-result`, `text-start`, `text-delta`, `text-end`, `finish`, (`error` on abort). 한 turn 에 8 tool call 까지 깨끗이 분류됨.

**ai-sdk-provider-claude-code 는 `step-start` / `finish-step` chunk 를 별도로 노출하지 않는다.** Step 경계가 필요하면 `tool-call` / `tool-result` chunk pair 로 근사 (step-steering 모드에서 검증, `packages/app/src/runtime/handlers/step.ts`).

> rev. 3 디테일 — `traceLogger.wrapStream` 은 정상 종료(close), 에러, consumer cancel 세 경로 모두에서 turn.end 요약을 한 번만 찍도록 ReadableStream 직접 구현 (TransformStream `flush` 가 cancel 경로에서 호출되지 않는 ai-sdk codex P2 부수 발견). 또한 `params.prompt` 가 `string` 인 케이스는 `chars=`, `ModelMessage[]` 인 케이스는 `messages=` 로 분리해서 trace.

## ai-sdk LanguageModelV3Middleware

ai-sdk 공식 인터페이스. 세 hook 이 있다 (`https://ai-sdk.dev/docs/ai-sdk-core/middleware`):

```ts
interface LanguageModelV3Middleware {
  // turn 시작 직전 — 파라미터(prompt 포함) 변형
  transformParams?: (options: { params, type: 'generate' | 'stream' }) => Promise<params>;

  // non-streaming 호출 래핑
  wrapGenerate?: (options: { doGenerate, params, model }) => Promise<Result>;

  // streaming 호출 래핑
  wrapStream?: (options: { doStream, params, model }) => Promise<{ stream, ... }>;
}
```

배열로 등록하면 `wrapLanguageModel({ model, middleware: [a, b] })` 가 `a(b(model))` 순서로 합성한다.

## turn-context propagation (`runtime/turn-context.ts`)

step 4.6 cbc0208 — middleware 가 trigger-time channelId/threadId 같은 turn 메타에 접근하기 위한 AsyncLocalStorage 패턴.

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface SenaTurnContext {
  adapter?: string;        // "slack" 등 (Slack 외 어댑터 추가 시 분기 키)
  channelId?: string;      // bare Slack channel id (C... / G... / D...)
  threadId?: string;       // chat-sdk thread id (slack:C...:ts)
  trigger?: 'mention' | 'subscribed-message' | 'schedule';
}

const storage = new AsyncLocalStorage<SenaTurnContext>();

export function getTurnContext(): SenaTurnContext | undefined { return storage.getStore(); }
export function runWithTurnContext<T>(context: SenaTurnContext, fn: () => T): T { /* compact + storage.run */ }
```

### 진입 지점 (`run()`)

`packages/app/src/runtime/run.ts` 가 두 chat-sdk 콜백 진입 시점에 frame 을 연다:

```ts
chat.onNewMention(async (thread, message, context) => {
  await drain.track("onNewMention", async () => {
    await thread.subscribe();
    await runWithTurnContext(resolveChatTurnContext(thread, "mention"), () =>
      onMention(thread, message, context),
    );
  });
});
chat.onSubscribedMessage(async (thread, message, context) => {
  await drain.track("onSubscribedMessage", async () => {
    await runWithTurnContext(resolveChatTurnContext(thread, "subscribed-message"), () =>
      onMessage(thread, message, context),
    );
  });
});
```

`resolveChatTurnContext(thread, trigger)` 는 `thread.threadId ?? thread.id` + `thread.channelId ?? threadId` 를 helper(`channelIdFromChatSdkId`, `adapterFromChatSdkId`) 로 정규화해 `{ adapter, channelId, threadId, trigger }` 를 만든다.

cron 발화 콜백(`runtime/scheduleFanOut.ts`) 도 같은 패턴으로 frame 을 연다 — `trigger: 'schedule'`, `channelId` / `threadId` 는 `target` 에서 도출. 따라서 cron turn 도 channelContext middleware 의 channel-memory 합성을 그대로 받는다.

### `channelContext` 사용 예 (코드 기준)

```ts
// packages/app/src/middlewares/channel-context.ts
import { getTurnContext } from "../runtime/turn-context.js";

export function channelContext(options: ChannelContextOptions): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      const turn = getTurnContext();
      if (!turn?.channelId) return params;        // turn-context 미진입 또는 채널 식별 실패 → 합성 스킵

      const contextText = await loadChannelContextText(options, cwd, turn.channelId);
      if (!contextText) return params;

      return appendSystemMessage(params, contextText);
    },
  };
}
```

즉 `channelContext` 는 thread/handler 에서 channel id 를 prop drilling 받지 않는다. `run()` 이 연 AsyncLocalStorage frame 을 통해 turn 별로 자동 격리된 `channelId` 를 읽는다. 따라서 동일 프로세스에서 여러 thread 의 turn 이 concurrent 로 돌아도 middleware 가 보는 `getTurnContext()` 는 자기 turn 의 값.

> turn-context propagation 흐름 전체는 `docs/specs/architecture.md` "turn-context propagation" 절도 참조. 두 문서가 같은 코드(`runtime/turn-context.ts`) 를 가리키는 cross-link.

## v2 hook → v3 middleware 매핑

| v2 의도                            | v3 에서 어디                                | 어떻게                                                                                          |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `system` prompt 합성 (channelContext, sunnySystemHook 등) | `transformParams` + `runtime/turn-context.ts` | `getTurnContext().channelId` 로 trigger-time channel 식별 → `channels.json`/memory 를 system prepend. |
| `TurnStartHook`                    | `wrapGenerate` / `wrapStream` 진입 시점     | `doGenerate` 호출 *전* 에 작업.                                                                  |
| `TurnEndCallback`                  | `wrapGenerate` / `wrapStream` 탈출 시점     | `doGenerate` 결과 받은 *후* 에 작업.                                                             |
| `traceLogger`                      | `wrapStream`                                | stream chunk 별로 관찰. tool call · text delta 단위 로그.                                         |
| `defineTool` (Zod 인라인 도구)     | **middleware 아님**                         | `docs/specs/tools.md` 의 ai-sdk native ToolSet (`config.tools`) 또는 인라인 MCP 우회.               |

## 합성 순서 (코드 기준)

starter (`templates/slack-agent/src/index.ts`) 와 PoC 모두 다음 순서:

```ts
middlewares: [
  channelContext({ ... }),     // 가장 바깥. transformParams 에서 system prompt 변형
  traceLogger({ label: ... }), // 가장 안쪽. 모든 변형 후 stream 관찰
]
```

> `wrapLanguageModel({ model, middleware: [a, b] })` 의 합성 순서가 `a(b(model))` 이라, 배열 첫 번째가 가장 바깥. system prompt 합성을 가장 바깥에 두어야 trace 가 *최종 prompt 모양* 을 본다.

## chat-sdk 핸들러 hook 과의 분리

chat-sdk 도 이벤트 단위 핸들러를 노출한다 (`onNewMention` 등). 두 레이어가 책임지는 것을 분리:

| 책임                                | ai-sdk middleware | chat-sdk handler |
| ----------------------------------- | :---------------: | :--------------: |
| LanguageModel turn 직전 prompt 변형 |        ⭕        |        ❌        |
| tool call 단위 trace                |        ⭕        |        ❌        |
| Slack message 받기 / 보내기          |        ❌        |        ⭕        |
| reaction trigger 분기 / abort       |        ❌        |        ⭕        |
| trigger filter (channelId·userId)   |        ❌        |        ⭕        |

## 검증 결과 (rev. 3)

- ✅ chat-sdk `before/after respond` 핸들러 미들웨어 별도 노출 없음. ai-sdk `transformParams` 가 system prompt 합성의 정답 위치. PoC 에서 그대로 검증.
- ✅ `restart_agent` 같은 워커 lifecycle 훅은 v3 에서 단일 프로세스 + drain wrapper 패턴으로 흡수 (확정 결정 #3). v2 의 worker 분리 자체가 사라지므로 별도 훅 불필요.
- ✅ middleware 가 trigger-time channelId/threadId 를 받기 위한 prop drilling 대신 `runtime/turn-context.ts` AsyncLocalStorage 채택. cbc0208 에서 `run()` 이 두 chat-sdk 콜백 + cron fan-out 모두에 `runWithTurnContext({...}, () => handler(...))` frame 을 박아 `channelContext.transformParams` 가 `getTurnContext()` 로 자기 turn 의 channelId 를 안전히 읽는다.

## AC

1. starter 에이전트가 `channelContext` 미들웨어로 채널 메모를 turn 입력에 합성하는 것이 trace 로그(`turn.start` / `turn.end`) 로 확인 가능.
2. `traceLogger` 미들웨어가 chunk 단위로 stdout 에 trace 를 남기고, 한 turn 의 시작·끝·tool call 횟수를 한 줄 요약으로 출력한다.
3. 동일 프로세스에서 두 thread 의 turn 이 concurrent 로 돌 때, 각 turn 의 `getTurnContext()` 가 자기 turn 의 channelId/threadId 를 반환한다 (AsyncLocalStorage 격리).
4. v2 `reviewGate` 같은 사용자 hook 을 v3 middleware 로 옮기는 마이그 가이드가 `migration.md` 에 한 절(節) 이상 있다.
