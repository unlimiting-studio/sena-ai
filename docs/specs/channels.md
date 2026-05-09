# Channel Context

**상태:** rev. 2 (PoC 0단계 검증 결과 반영).

## 한 줄

채널 단위 메타(설명·리포지토리·메모)를 한 turn의 system prompt에 합성한다. v2의 `channels.json` + per-channel `memory.md` 패턴을 유지하고, **합성 위치는 ai-sdk middleware (`transformParams`)로 확정** (PoC 0단계, 2026-05-10).

## 파일 구조 (1차 가설, v2 호환)

```
.sena/
├── channels.json
└── channels/
    └── {channelId}/
        └── memory.md
```

`channels.json` 1차 안:

```json
{
  "C0AFW5Y133J": {
    "name": "project-sena",
    "description": "codex 및 claude code를 에이전트 하네스로 사용하는 엔진",
    "repositories": ["https://github.com/unlimiting-studio/sena-ai"],
    "memory": "channels/C0AFW5Y133J/memory.md",
    "notes": "..."
  }
}
```

## 합성 동작

한 turn 시작 시:
1. `conversation.id`(Slack channel ID)로 `channels.json` 항목 조회.
2. 항목이 있으면 `description` + `repositories` + lazy-read한 `memory` 본문을 합쳐 system prompt 후보로 만든다.
3. 다른 system prompt(앱 전체 baseline)와 병합하여 최종 system 메시지 구성.

## 합성 위치 ✅ 확정

**ai-sdk middleware `transformParams`에서 합성한다.** PoC 0단계에서 chat-sdk가 자체 system prompt 합성 hook을 별도로 노출하지 않는 것이 확인됐다 (`docs/specs/hooks.md` rev. 2 §"검증 결과"). LanguageModel 호출 직전 단계라 cron 셀프 트리거에도 동일하게 적용된다는 게 본질적인 장점.

```ts
function channelContext(): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    transformParams: async ({ params }) => {
      const channelId = extractChannelIdFromParams(params); // adapter conversation id 활용
      const meta = await loadChannelMeta(channelId);        // channels.json + lazy-read memory.md
      if (!meta) return params;
      const systemAddition = composeChannelSystem(meta);
      return prependSystem(params, systemAddition);
    },
  };
}
```

## v2와 다른 점

- **합성 위치**: v2는 `TurnStartHook`에서 message 본문 자체를 변형했지만, v3는 LanguageModel 입력 단계의 system 메시지로 분리한다.
- **memory 형식**: v2는 markdown 본문을 그대로 prompt에 넣었다. v3에서도 동일하지만, 길이가 길어지는 경우(예: 5000자+) 자동 요약 또는 잘라내기 정책을 둘지 — 1차 마이그에서 결정.

## 후속 (1차 마이그에서 마무리)

- 채널이 여러 어댑터(Slack + 그 외)에 동시에 매핑되는 경우 key 충돌 정책 — 1차 범위는 Slack 단일이라 우회. 본 마이그 §1에서 namespace prefix(`slack:` / `discord:`) 도입 시점에 결정.
- `memory.md`가 길어질 때(예: 5000자 초과) 자동 요약/잘라내기 정책 — 본 마이그 §1 turn 이후 첫 회귀에서 결정.

## AC

1. PoC 에이전트가 `#project-sena` 채널에서 멘션 받았을 때, system prompt에 채널 description + memory 본문이 들어가 있는 게 trace 로그로 확인 가능.
2. 메모리 파일을 수정하고 새 turn 시작 시 변경된 본문이 즉시 반영된다 (lazy read 검증).
3. `channels.json`에 등록되지 않은 채널에서도 빈 메모리로 정상 동작한다 (FAIL 없이).
