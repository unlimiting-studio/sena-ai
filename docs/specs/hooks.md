# Hooks (Middleware)

**상태:** rev. 2 (PoC 0단계 검증 결과 반영).

## 한 줄

v2의 `TurnStart` / `TurnEnd` / `system 합성` 의도를 ai-sdk `LanguageModelV3Middleware` 위에 다시 짠다. **함수 시그니처는 v2와 다르다.** 1:1 자동 마이그 안 됨.

## 0단계 검증 결과 ✅

PoC에서 `traceLogger` middleware로 `transformParams` + `wrapStream` 양쪽 라이브 검증:

```ts
// sena-poc/src/middlewares/trace.ts
export function traceLogger(label: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params, type }) => {
      console.log(`[${label}] turn.start type=${type} promptParts=${params.prompt.length}`);
      return params;
    },
    wrapStream: async ({ doStream, model }) => {
      const start = Date.now();
      const result = await doStream();
      const counts = new Map<string, number>();
      const transformedStream = result.stream.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          counts.set(chunk.type, (counts.get(chunk.type) ?? 0) + 1);
          controller.enqueue(chunk);
        },
        flush() {
          const elapsed = Date.now() - start;
          console.log(`[${label}] turn.end model=${model.modelId} elapsed=${elapsed}ms ` +
            Array.from(counts.entries()).map(([k, v]) => `${k}=${v}`).join(" "));
        },
      }));
      return { ...result, stream: transformedStream };
    },
  };
}
```

**노출 chunk types** (claude-code provider 기준): `stream-start`, `response-metadata`, `reasoning-start`, `reasoning-delta`, `reasoning-end`, `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-call`, `tool-result`, `text-start`, `text-delta`, `text-end`, `finish`, (`error` on abort). 한 turn에 8 tool call까지 깨끗이 분류됨.

**ai-sdk-provider-claude-code는 `step-start` / `finish-step` chunk를 별도로 노출하지 않는다.** Step 경계가 필요하면 `tool-call` / `tool-result` chunk pair로 근사 (sena-poc step-steering 모드에서 검증).

## ai-sdk LanguageModelV3Middleware

ai-sdk 공식 인터페이스. 세 hook이 있다 (`https://ai-sdk.dev/docs/ai-sdk-core/middleware`):

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

## v2 hook → v3 middleware 매핑

| v2 의도                            | v3에서 어디                                 | 어떻게                                                                 |
| ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| `system` prompt 합성 (channelContext, sunnySystemHook 등) | `transformParams`                          | `params.prompt`(또는 `params.messages`) 앞에 system 메시지 prepend.     |
| `TurnStartHook`                    | `wrapGenerate` / `wrapStream` 진입 시점     | `doGenerate` 호출 *전*에 작업.                                          |
| `TurnEndCallback`                  | `wrapGenerate` / `wrapStream` 탈출 시점     | `doGenerate` 결과 받은 *후*에 작업.                                     |
| `traceLogger`                      | `wrapStream`                                | stream chunk 별로 관찰. tool call · text delta 단위 로그.                |
| `defineTool` (Zod 인라인 도구)     | **middleware 아님**                         | `docs/specs/tools.md`에서 별도 처리. claude-code provider Zod tool 미지원. |

## 합성 순서 (1차 가설)

```ts
middlewares: [
  channelContext(),   // 가장 바깥. system prompt 변형 전에 채널 메모를 추가
  systemCompose(),    // 정적 system 프롬프트 + 동적 발 합성
  traceLogger(),      // 가장 안쪽. 모든 변형이 끝난 직후 stream 관찰
]
```

> 합성 순서는 PoC에서 검증한 뒤 SPEC rev. 2에서 확정.

## chat-sdk 핸들러 hook과의 분리

chat-sdk도 이벤트 단위 핸들러를 노출한다 (`onNewMention` 등). 두 레이어가 책임지는 것을 분리:

| 책임                                | ai-sdk middleware | chat-sdk handler |
| ----------------------------------- | :---------------: | :--------------: |
| LanguageModel turn 직전 prompt 변형 |        ⭕        |        ❌        |
| tool call 단위 trace                |        ⭕        |        ❌        |
| Slack message 받기 / 보내기          |        ❌        |        ⭕        |
| reaction trigger 분기 / abort       |        ❌        |        ⭕        |
| trigger filter (channelId·userId)   |        ❌        |        ⭕        |

## 검증 결과 (rev. 2)

- **chat-sdk `before/after respond` 핸들러 미들웨어 별도 노출 없음.** ai-sdk `transformParams`가 system prompt 합성의 정답 위치. PoC에서 그대로 검증.
- **`restart_agent` 같은 워커 lifecycle 훅은 v3에서 단일 프로세스 + drain wrapper 패턴으로 흡수** (확정 결정 #3). v2의 worker 분리 자체가 사라지므로 별도 훅 불필요.

## AC

1. PoC 에이전트가 `channelContext` 미들웨어로 채널 메모를 turn 입력에 합성하는 것이 trace 로그로 확인 가능.
2. `traceLogger` 미들웨어가 chunk 단위로 stdout에 trace를 남기고, 한 turn의 시작·끝·tool call 횟수를 한 줄 요약으로 출력한다.
3. v2 `reviewGate` 같은 사용자 hook을 v3 middleware로 옮기는 마이그 가이드가 `migration.md`에 한 절(節) 이상 있다.
