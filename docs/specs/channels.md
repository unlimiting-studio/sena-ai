# Channel Context

## 한 줄

채널 단위 메타(설명·리포지토리·메모)를 한 turn의 system prompt에 합성한다. v2의 `channels.json` + per-channel `memory.md` 패턴을 유지하되 **합성 위치는 ai-sdk middleware 또는 chat-sdk 핸들러 둘 중 하나로 결정** (검증 필요).

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

## 합성 위치 (검증 필요)

| 옵션                                      | 장점                                                        | 단점                                                                              |
| ----------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **A. ai-sdk middleware (`transformParams`)** | LanguageModel 호출 직전이라 cron 트리거에도 자동 적용         | chat-sdk가 자체 system 합성 hook을 노출한다면 두 레이어가 중복.                     |
| **B. chat-sdk 핸들러 (before-respond)**     | chat-sdk Conversation 단계라 chat-sdk 자체 추상화에 자연스러움 | chat-sdk의 합성 hook 시그니처가 어디까지 노출되는지 미상. cron 트리거에도 적용되는지 확인 필요. |

→ **1차 마이그에서 두 옵션 모두 시도해 보고 결정.** 기본 가설은 A (`docs/specs/hooks.md` §"v2 hook → v3 middleware 매핑"의 `system` prompt 합성 행).

## v2와 다른 점

- **합성 위치**: v2는 `TurnStartHook`에서 message 본문 자체를 변형했지만, v3는 LanguageModel 입력 단계의 system 메시지로 분리한다.
- **memory 형식**: v2는 markdown 본문을 그대로 prompt에 넣었다. v3에서도 동일하지만, 길이가 길어지는 경우(예: 5000자+) 자동 요약 또는 잘라내기 정책을 둘지 — 1차 마이그에서 결정.

## 검증 필요

- chat-sdk `Chat` 또는 `Conversation` 클래스가 per-conversation 정적 system prompt API를 제공한다면, 동적 합성(파일 lazy read)을 그 위에 어떻게 얹을지.
- 채널이 여러 어댑터(Slack + 그 외)에 동시에 매핑되는 경우, key 충돌을 어떻게 다룰지 — 1차 범위에서는 Slack 하나라 우회.

## AC

1. PoC 에이전트가 `#project-sena` 채널에서 멘션 받았을 때, system prompt에 채널 description + memory 본문이 들어가 있는 게 trace 로그로 확인 가능.
2. 메모리 파일을 수정하고 새 turn 시작 시 변경된 본문이 즉시 반영된다 (lazy read 검증).
3. `channels.json`에 등록되지 않은 채널에서도 빈 메모리로 정상 동작한다 (FAIL 없이).
