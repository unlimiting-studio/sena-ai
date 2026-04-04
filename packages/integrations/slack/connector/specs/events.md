# Slack Event Processing

## 한 줄 요약

Slack 이벤트를 필터링, dedupe, trigger arbitration, 파일 다운로드, 사용자 이름 해소를 거쳐 `InboundEvent` 또는 control action으로 변환한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`, `SLACK-CONN-FR-007`, `SLACK-CONN-FR-008`
- Related AC: `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`, `SLACK-CONN-AC-007`, `SLACK-CONN-AC-008`

## Behavior

### `SLACK-EVENT-01` 메시지 trigger 후보 계산

- Trigger: `app_mention` 또는 `message`
- Main Flow:
  - raw Slack 이벤트를 human-authored message인지 먼저 판별한다.
  - 아래 trigger 후보를 동시에 계산한다.
    - `mention`: `app_mention`이거나 본문에 봇 멘션이 포함됨
    - `thread`: `thread_ts`가 있고 봇이 그 스레드에 참여한 상태임
    - `channel`: `thread_ts` 없는 최상위 일반 채널 메시지임
  - 설정상 비활성인 후보는 제거한다.

### `SLACK-EVENT-02` 메시지 trigger 중재와 turn 제출

- Trigger: `SLACK-EVENT-01`에서 1개 이상 후보가 남음
- Main Flow:
  - normalized message key(`{channel}:{thread_ts || ts}`)를 만든다.
  - 같은 message key에 대해 중복 raw 이벤트가 들어와도 한 번만 처리한다.
  - 후보가 여러 개면 `priority` 배열 순서대로 가장 높은 trigger 하나를 선택한다.
  - 선택된 trigger의 prompt source를 resolve하고, 원본 Slack 메시지와 함께 `InboundEvent.text`를 구성한다.
  - 파일 다운로드, 사용자 이름 해소 후 `engine.submitTurn()` 한다.

### `SLACK-EVENT-03` reaction rule 처리

- Trigger: `reaction_added`
- Main Flow:
  - reaction name으로 `reactions` 맵을 조회한다.
  - 규칙이 없으면 무시한다.
  - 규칙이 `{ action: 'abort' }`이면 대상 스레드의 `conversationId`를 구해 `engine.abortConversation()`을 호출한다.
  - 규칙이 prompt source이면 대상 메시지/스레드 정보를 조회해 reaction context용 `InboundEvent`를 만든다.

### `SLACK-EVENT-04` 파일 다운로드와 사용자 이름 해소

- Trigger: 메시지에 files 배열이 있음 또는 user id 표시가 필요함
- Main Flow:
  - 파일은 임시 디렉터리 `slack-files/` 하위에 저장한다.
  - 사용자 이름은 `users.info`와 인메모리 캐시로 해소한다.

### `SLACK-EVENT-05` prompt 합성

- Trigger: message trigger 또는 reaction rule이 turn 생성으로 결정됨
- Main Flow:
  - prompt source가 string이면 그대로 사용한다.
  - prompt source가 `{ file }`면 UTF-8 텍스트로 읽는다.
  - message trigger는 `resolvedPrompt`와 원본 메시지 텍스트를 함께 보존하는 형태로 입력을 구성한다.
  - reaction trigger는 `resolvedPrompt`와 함께 reaction name, 대상 메시지 text, channel/thread 식별자를 포함한 구조화 텍스트를 만든다.

## Constraints

- `SLACK-EVENT-C-001`: `bot_id`가 있는 메시지와 불필요한 subtype 메시지는 처리하면 안 된다.
- `SLACK-EVENT-C-002`: 동일 message key에 대해 message trigger는 최대 하나의 turn만 생성해야 한다.
- `SLACK-EVENT-C-003`: priority 배열에는 `mention`, `thread`, `channel`이 중복 없이 들어가야 한다.
- `SLACK-EVENT-C-004`: 최상위 일반 채널 메시지(`thread_ts` 없음)는 channel trigger가 명시적으로 켜져 있을 때만 처리해야 한다.
- `SLACK-EVENT-C-005`: prompt file 읽기 실패는 조용히 빈 문자열로 폴백하면 안 되며, 해당 액션은 실패로 기록돼야 한다.

## Interface

- Supported input:
  - `app_mention`
  - `message`
  - `reaction_added`
- Inbound mapping:
  - `connector = 'slack'`
  - `conversationId = {channel}:{thread_ts || ts}`
  - `userId`, `userName`, `text`, `files`, `raw`
  - `raw.triggerKind = 'mention' | 'thread' | 'channel' | 'reaction'`

## Realization

- 모듈 경계:
  - `connector.ts` 내부 보조 함수 `resolveUserName`, `wasBotInThread`, `downloadSlackFiles`, `processSlackEvent`, `resolvePromptSource`, `selectMessageTrigger`
- 상태 모델:
  - dedupe 슬롯, active thread, user cache, normalized message key
- 실패 처리:
  - 파일 다운로드 실패 시 localPath 없는 기본 파일 메타데이터로 폴백한다.
  - prompt file 실패는 해당 액션만 중단하고 다음 이벤트 처리는 계속한다.

## Dependencies

- Depends On: [configuration.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/configuration.md), [connector.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/connector.md)
- Blocks: `output.md`
- Parallelizable With: `verify.md`

## AC

- Given `app_mention`이 들어오고 mention trigger가 켜져 있을 때 When connector가 처리하면 Then `mention` trigger로 `InboundEvent`가 생성된다.
- Given 활성 스레드 후속 메시지가 들어오고 thread trigger가 켜져 있을 때 When connector가 처리하면 Then 멘션 없이도 턴이 제출된다.
- Given 최상위 메시지가 mention과 channel을 동시에 만족할 때 When connector가 처리하면 Then priority가 높은 trigger 하나만 실행된다.
- Given `eyes` reaction에 prompt rule이 있을 때 When reaction이 달리면 Then reaction context를 포함한 turn이 제출된다.
- Given `x` reaction에 abort rule이 있을 때 When reaction이 달리면 Then 해당 대화에 대한 abort가 시도된다.

## 개편 메모

- 이벤트 스펙을 raw Slack 이벤트 기준에서 trigger arbitration 중심으로 재구성했다.
