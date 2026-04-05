# Slack Event Processing

## 한 줄 요약

Slack 이벤트를 필터링, dedupe, trigger arbitration, 파일 다운로드, 사용자 이름 해소를 거쳐 `InboundEvent` 또는 control action으로 변환한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`, `SLACK-CONN-FR-007`, `SLACK-CONN-FR-008`, `SLACK-CONN-FR-010`, `SLACK-CONN-FR-011`, `SLACK-CONN-FR-012`, `SLACK-CONN-FR-013`, `SLACK-CONN-FR-014`, `SLACK-CONN-FR-015`, `SLACK-CONN-FR-016`
- Related AC: `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`, `SLACK-CONN-AC-007`, `SLACK-CONN-AC-008`, `SLACK-CONN-AC-010`, `SLACK-CONN-AC-011`, `SLACK-CONN-AC-012`, `SLACK-CONN-AC-013`, `SLACK-CONN-AC-014`, `SLACK-CONN-AC-015`, `SLACK-CONN-AC-016`, `SLACK-CONN-AC-017`, `SLACK-CONN-AC-018`, `SLACK-CONN-AC-019`, `SLACK-CONN-AC-020`, `SLACK-CONN-AC-021`, `SLACK-CONN-AC-022`, `SLACK-CONN-AC-023`

## Behavior

### `SLACK-EVENT-01` 메시지 trigger 후보 계산

- Trigger: `app_mention` 또는 `message`
- Main Flow:
  - raw Slack 이벤트를 human-authored message인지 먼저 판별한다.
  - 아래 trigger 후보를 동시에 계산한다.
    - `mention`: `app_mention`이거나 본문에 봇 멘션이 포함됨
    - `thread`: `thread_ts`가 있고 봇이 그 스레드에 참여한 상태임
    - `directMessage`: Slack 1:1 DM 채널(`channel_type = 'im'`, fallback으로 channel id prefix `D`) 메시지임. 최상위 메시지와 DM 내부 후속 답글을 모두 포함한다.
    - `channel`: `thread_ts` 없는 최상위 일반 채널 메시지이며 direct message는 제외한다.
    - `message`: 채널 메시지, direct message, 또는 쓰레드 메시지(봇 참여 여부 무관)를 모두 받는 범용 후보다. `thread` key가 활성이고 봇이 참여한 스레드이면 `thread` 후보가 우선순위에서 먼저 선택되므로 중복 실행은 없다. `directMessage` key가 활성이고 DM이면 `directMessage` 후보가 먼저 선택된다. 항상 가장 낮은 우선순위.
  - 설정상 key가 없는 후보는 제거한다.

### `SLACK-EVENT-02` 메시지 trigger 중재와 filter 평가

- Trigger: `SLACK-EVENT-01`에서 1개 이상 후보가 남음
- Main Flow:
  - normalized message key(`{channel}:{thread_ts || ts}`)를 만든다.
  - 같은 message key에 대해 중복 raw 이벤트가 들어와도 한 번만 처리한다.
  - 후보를 고정 순서 `mention > thread > directMessage > channel > message`로 평가한다.
  - 각 후보마다 정규화된 `SlackMessageTriggerEvent`를 만든 뒤:
    - trigger 필드가 function이면 function을 호출한다. `false`/`undefined`/`void` 반환 시 다음 후보로 넘어간다. 유효한 반환값이면 해당 후보가 선택되고, 이 반환값을 그대로 `SLACK-EVENT-03` prompt resolution에 전달한다. 같은 Slack 이벤트 내에서 동일 function을 두 번 호출하지 않는다.
    - trigger 필드가 object이고 `filter`가 있으면 filter를 실행한다.
  - filter가 `false`면 더 낮은 우선순위 후보를 계속 평가한다.
  - filter가 통과하면 그 후보가 선택된다.

### `SLACK-EVENT-03` 메시지 turn 제출

- Trigger: `SLACK-EVENT-02`에서 후보가 선택됨
- Main Flow:
  - 선택된 trigger의 prompt source를 resolve한다.
    - trigger 필드가 function이었으면, `SLACK-EVENT-02`에서 얻은 반환값을 prompt source로 사용한다. 같은 이벤트 내에서 function을 다시 호출하지 않는다.
    - trigger 필드가 string 또는 object이면 기존 규칙대로 resolve한다.
  - thinkingMessage를 결정한다: trigger-level (object 필드 또는 function 반환값) > 전역 설정.
  - resolved thinkingMessage를 `InboundEvent.raw.thinkingMessage`에 안정된 top-level 필드로 포함한다. 이 값은 worker가 `ConnectorOutputContext.metadata`로 전달하므로 `createOutput` 시점에 `context.metadata.thinkingMessage`로 올바르게 수신된다.
  - 원본 Slack 메시지와 함께 `InboundEvent.text`를 구성한다.
  - 파일 다운로드, 사용자 이름 해소 후 `engine.submitTurn()` 한다.

### `SLACK-EVENT-04` reaction rule 처리

- Trigger: `reaction_added`
- Main Flow:
  - reaction name으로 `reactions` 맵을 조회한다.
  - 규칙이 없으면 무시한다.
  - 대상 메시지와 thread 정보를 먼저 조회해 reaction용 `SlackReactionTriggerEvent`를 만든다.
  - rule이 function이면:
    - 보강된 reaction event로 function을 호출한다.
    - `false`/`undefined`/`void` 반환 시 무시한다.
    - `{ abort: true }` 반환 시 abort action으로 처리한다 (`thinkingMessage`는 abort 경로에 적용되지 않는다).
    - prompt source 반환 시 해당 값으로 turn을 제출한다. 반환값에 `thinkingMessage`가 포함되면 trigger-level 설정으로 사용한다.
  - rule이 object이고 `filter`가 있으면 보강된 reaction event로 먼저 평가한다.
  - 규칙이 `{ action: 'abort' }`이면 대상 스레드의 `conversationId`를 구해 `engine.abortConversation()`을 호출한다. abort 경로에서는 `ConnectorOutput`을 생성하지 않으므로 `thinkingMessage`는 무시한다.
  - 규칙이 prompt source이면 이미 조회한 대상 메시지/스레드 정보를 사용해 reaction context용 `InboundEvent`를 만든다.
  - prompt source 경로에서 thinkingMessage를 결정한다: trigger-level (object 필드 또는 function 반환값) > 전역 설정. resolved thinkingMessage를 `InboundEvent.raw.thinkingMessage`에 포함하여 `ConnectorOutputContext.metadata`를 통해 turn 단위로 전달한다.

### `SLACK-EVENT-05` 파일 다운로드와 사용자 이름 해소

- Trigger: 메시지에 files 배열이 있음 또는 user id 표시가 필요함
- Main Flow:
  - 파일은 임시 디렉터리 `slack-files/` 하위에 저장한다.
  - 사용자 이름은 `users.info`와 인메모리 캐시로 해소한다.

### `SLACK-EVENT-06` prompt 합성

- Trigger: message trigger 또는 reaction rule이 turn 생성으로 결정됨
- Main Flow:
  - prompt source가 string이면 그대로 사용한다.
  - prompt source가 `{ text }`면 해당 텍스트를 사용한다.
  - prompt source가 `{ file }`면 `config.cwd`를 우선 기준으로, 없으면 `sena.config.ts` 디렉터리 기준으로 UTF-8 텍스트를 읽는다.
  - message trigger는 `resolvedPrompt`와 원본 메시지 텍스트를 함께 보존하는 형태로 입력을 구성한다.
  - reaction trigger는 `resolvedPrompt`와 함께 reaction name, 대상 메시지 text, channel/thread 식별자를 포함한 구조화 텍스트를 만든다.

## Constraints

- `SLACK-EVENT-C-001`: `bot_id`가 있는 메시지와 불필요한 subtype 메시지는 처리하면 안 된다.
- `SLACK-EVENT-C-002`: 동일 message key에 대해 message trigger는 최대 하나의 turn만 생성해야 한다.
- `SLACK-EVENT-C-003`: 메시지 계열 trigger 우선순위는 고정 `mention > thread > directMessage > channel > message`이며 설정으로 override하지 않는다.
- `SLACK-EVENT-C-004`: 최상위 일반 채널 메시지(`thread_ts` 없음)는 `channel` 또는 `message` key가 명시적으로 있을 때만 처리해야 한다.
- `SLACK-EVENT-C-009`: Slack 1:1 direct message는 `directMessage` 또는 `message` key가 명시적으로 있을 때만 처리해야 하며, `channel` 후보로 분류하면 안 된다.
- `SLACK-EVENT-C-005`: prompt file 읽기 실패는 조용히 빈 문자열로 폴백하면 안 되며, 해당 액션은 실패로 기록돼야 한다.
- `SLACK-EVENT-C-006`: filter throw/reject 또는 trigger function throw/reject는 silent pass로 처리하면 안 되며, 해당 이벤트는 실패 처리해야 한다.
- `SLACK-EVENT-C-007`: reaction filter는 reacted message lookup 뒤, 메시지 작성자/본문/thread 정보가 채워진 event를 받아야 한다.
- `SLACK-EVENT-C-008`: reaction filter event의 `threadTs`는 lookup 뒤 항상 채워져야 하며, 최상위 메시지 reaction이면 `ts`와 같아야 한다.

## Interface

- Supported input:
  - `app_mention`
  - `message`
  - `reaction_added`
- Inbound mapping:
  - `connector = 'slack'`
  - `conversationId = {channel}:{thread_ts || ts}`
  - `userId`, `userName`, `text`, `files`, `raw`
  - `raw.triggerKind = 'mention' | 'thread' | 'directMessage' | 'channel' | 'message' | 'reaction'`

## Realization

- 모듈 경계:
  - `connector.ts` 내부 보조 함수 `resolveUserName`, `wasBotInThread`, `downloadSlackFiles`, `processSlackEvent`, `resolvePromptSource`, `resolveTriggerFunction`, `resolveThinkingMessage`, `isDirectMessageChannel`, `selectMessageTrigger`, `buildTriggerEvent`, `runTriggerFilter`
- 상태 모델:
  - dedupe 슬롯, active thread, user cache, normalized message key
- 실패 처리:
  - 파일 다운로드 실패 시 localPath 없는 기본 파일 메타데이터로 폴백한다.
  - prompt file 실패는 해당 액션만 중단하고 다음 이벤트 처리는 계속한다.
  - filter throw/reject는 해당 이벤트를 drop하고 에러를 기록한다.
  - reaction target lookup 실패는 filter 평가 전에 해당 reaction 이벤트를 실패 처리한다.

## Dependencies

- Depends On: [configuration.md](./configuration.md), [connector.md](./connector.md)
- Blocks: [output.md](./output.md)
- Parallelizable With: [verify.md](./verify.md)

## AC

- Given `app_mention`이 들어오고 mention key가 있을 때 When connector가 처리하면 Then `mention` trigger로 `InboundEvent`가 생성된다.
- Given 활성 스레드 후속 메시지가 들어오고 thread key가 있을 때 When connector가 처리하면 Then 멘션 없이도 턴이 제출된다.
- Given 최상위 메시지가 mention과 channel을 동시에 만족할 때 When connector가 처리하면 Then 고정 우선순위에 따라 `mention` 하나만 실행된다.
- Given mention filter가 `false`를 반환하고 thread filter는 통과할 때 When 같은 메시지가 mention과 thread를 동시에 만족하면 Then thread가 실행된다.
- Given reaction rule filter가 `false`를 반환할 때 When reaction이 달리면 Then 그 reaction rule은 실행되지 않는다.
- Given reaction filter가 `event.userId`, `event.text`, `event.threadTs`를 읽을 때 When reaction이 달리면 Then reacted message 조회 뒤 채워진 값으로 평가된다.
- Given reacted message가 봇 메시지일 때 When reaction filter가 실행되면 Then target author는 `messageBotId`로 식별된다.
- Given `x` reaction에 abort rule이 있을 때 When reaction이 달리면 Then 해당 대화에 대한 abort가 시도된다.
- Given `message` trigger가 설정됐을 때 When 봇 미참여 쓰레드 메시지가 들어오면 Then `message` trigger로 `InboundEvent`가 생성된다.
- Given `message`와 `thread`가 모두 설정되고 봇 참여 쓰레드일 때 When 쓰레드 메시지가 들어오면 Then `thread`가 우선 실행된다.
- Given `directMessage` trigger가 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage` trigger로 `InboundEvent`가 생성된다.
- Given `directMessage`와 `message`가 모두 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage`가 우선 실행된다.
- Given `channel` trigger만 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then 이벤트는 무시된다.
- Given `mention: (event) => '동적 프롬프트'`일 때 When 멘션 이벤트가 들어오면 Then function 반환값이 inline prompt로 사용된다.
- Given `mention: (event) => false`일 때 When 멘션 이벤트가 들어오면 Then mention은 건너뛰고 다음 우선순위 후보를 평가한다.
- Given trigger function이 throw할 때 When 이벤트가 들어오면 Then 이벤트는 실패 처리되고 하위 우선순위 후보로 넘어가지 않는다.
- Given `mention: { text: '...', thinkingMessage: '분석 중...' }`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 멘션 turn이 제출되면 Then output에 '분석 중...'이 전달된다.
- Given `reactions.eyes: (event) => ({ abort: true })`일 때 When reaction이 달리면 Then abort가 실행된다.
- Given `triggers: { message: '...' }`이고 `channel` key가 없을 때 When 최상위 채널 메시지가 들어오면 Then `message` trigger가 실행된다.
- Given `channel`과 `message`가 모두 없을 때 When 최상위 채널 메시지가 들어오면 Then 이벤트는 무시된다.

## 개편 메모

- 이벤트 스펙에 per-trigger filter 평가 단계와 direct message 후보 계산 규칙을 추가했다.
