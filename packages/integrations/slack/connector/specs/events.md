# Slack Event Processing

## 한 줄 요약

Slack 이벤트를 필터링, dedupe, 파일 다운로드, 사용자 이름 해소를 거쳐 `InboundEvent`로 변환한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`
- Related AC: `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`

## Behavior

### `SLACK-EVENT-01` 최초 멘션 처리

- Trigger: `app_mention`
- Main Flow:
  - 이벤트 중복을 확인한다.
  - 스레드를 activeThreads에 등록한다.
  - 사용자 이름을 해소하고 첨부 파일을 다운로드한다.
  - `InboundEvent`를 만들어 `engine.submitTurn()` 한다.

### `SLACK-EVENT-02` 활성 스레드 후속 메시지

- Trigger: `message` with `thread_ts`
- Main Flow:
  - activeThreads에 있으면 일반 후속 메시지로 처리한다.
  - 없으면 `wasBotInThread()`로 히스토리를 조회해 복구를 시도한다.

### `SLACK-EVENT-03` 취소 리액션

- Trigger: `reaction_added` with `reaction = 'x'`
- Main Flow:
  - 대상 메시지 스레드를 찾는다.
  - `conversationId`를 만들고 `engine.abortConversation()`을 호출한다.

### `SLACK-EVENT-04` 파일 다운로드와 사용자 이름 해소

- Trigger: 메시지에 files 배열이 있음 또는 user id 표시가 필요함
- Main Flow:
  - 파일은 임시 디렉터리 `slack-files/` 하위에 저장한다.
  - 사용자 이름은 `users.info`와 인메모리 캐시로 해소한다.

## Constraints

- `SLACK-EVENT-C-001`: `bot_id`가 있는 메시지와 불필요한 subtype 메시지는 처리하면 안 된다.
- `SLACK-EVENT-C-002`: `app_mention`은 동일 메시지의 `message`보다 우선해야 한다.
- `SLACK-EVENT-C-003`: 최상위 일반 채널 메시지(`thread_ts` 없음)는 무시해야 한다.

## Interface

- Supported input:
  - `app_mention`
  - `message`
  - `reaction_added(:x:)`
- Inbound mapping:
  - `connector = 'slack'`
  - `conversationId = {channel}:{thread_ts || ts}`
  - `userId`, `userName`, `text`, `files`, `raw`

## Realization

- 모듈 경계:
  - `connector.ts` 내부 보조 함수 `resolveUserName`, `wasBotInThread`, `downloadSlackFiles`, `processSlackEvent`
- 상태 모델:
  - dedupe 슬롯, active thread, user cache
- 실패 처리:
  - 파일 다운로드 실패 시 localPath 없는 기본 파일 메타데이터로 폴백한다.

## Dependencies

- Depends On: Slack Web API, [connector.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/connector.md)
- Blocks: `output.md`
- Parallelizable With: `verify.md`

## AC

- Given `app_mention`이 들어올 때 When connector가 처리하면 Then activeThreads 등록과 함께 `InboundEvent`가 생성된다.
- Given 활성 스레드 후속 메시지가 들어올 때 When connector가 처리하면 Then 멘션 없이도 턴이 제출된다.
- Given `:x:` 리액션이 달릴 때 When connector가 처리하면 Then 해당 대화에 대한 abort가 시도된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 이벤트 입력 경로와 의존성을 명시했다.
