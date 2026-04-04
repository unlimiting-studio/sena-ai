# Slack Connector Configuration

## 1. 한 줄 요약 (Outcome Statement)

Slack connector 설정은 어떤 Slack 입력이 turn을 만들지, 겹치는 메시지 이벤트 중 무엇을 하나만 실행할지, 그리고 각 trigger에 어떤 prompt source를 붙일지를 선언한다.

---

## 2. 상위 스펙 연결 (Traceability)

- Related Goals:
  - 하드코딩된 Slack 반응 규칙을 선언형 설정으로 확장한다.
  - 하나의 사용자 액션에서 중복 turn 생성 없이 우선순위 기반으로 하나만 실행한다.
- Related Requirements (FR/NFR ID):
  - `SLACK-CONN-FR-002`
  - `SLACK-CONN-FR-003`
  - `SLACK-CONN-FR-007`
  - `SLACK-CONN-FR-008`
  - `SLACK-CONN-FR-009`
  - `SLACK-CONN-NFR-002`
- Related AC:
  - `SLACK-CONN-AC-002`
  - `SLACK-CONN-AC-003`
  - `SLACK-CONN-AC-007`
  - `SLACK-CONN-AC-008`
  - `SLACK-CONN-AC-009`

---

## 3. Behavior Specification

### 3.1 Flow 목록

#### Flow ID: SLACK-CONFIG-01

- Actor:
  Agent author
- Trigger:
  `slackConnector({ triggers })` 설정 작성
- Preconditions:
  - Slack connector가 생성되기 전이다.
- Main Flow:
  1. 작성자는 `mention`, `thread`, `channel`, `reactions` 규칙을 선언한다.
  2. connector는 누락 필드에 대해 backward-compatible default를 채운다.
  3. invalid priority / invalid reaction rule이면 시작 시점에 오류를 낸다.
- Alternative Flow:
  - `triggers` 전체가 생략되면 기존 기본값을 사용한다.
- Outputs:
  - 정규화된 `SlackTriggerConfig`
- Side Effects:
  - 없음
- Failure Modes:
  - priority 값이 중복되거나 허용되지 않은 trigger name을 포함함
  - reaction rule 형식이 prompt source 또는 control action 규칙을 만족하지 않음

#### Flow ID: SLACK-CONFIG-02

- Actor:
  Slack connector
- Trigger:
  하나의 Slack message event가 `mention`, `thread`, `channel` 후보를 동시에 만족함
- Preconditions:
  - 3개 trigger 중 둘 이상이 설정상 활성이다.
- Main Flow:
  1. connector는 해당 raw 이벤트에서 message trigger 후보 목록을 만든다.
  2. `priority` 순서대로 가장 높은 enabled trigger를 선택한다.
  3. 선택되지 않은 나머지 trigger는 실행하지 않는다.
- Alternative Flow:
  - 후보가 하나뿐이면 그 trigger를 그대로 실행한다.
  - 후보가 없으면 이벤트를 무시한다.
- Outputs:
  - 정확히 하나의 selected trigger 또는 `null`
- Side Effects:
  - 동일 message key에 대한 중복 실행 방지 슬롯 사용
- Failure Modes:
  - priority 배열이 비정상이라 선택을 확정할 수 없음

#### Flow ID: SLACK-CONFIG-03

- Actor:
  Slack connector
- Trigger:
  선택된 trigger가 turn 생성을 요구함
- Preconditions:
  - selected trigger 또는 reaction rule이 prompt source를 가짐
- Main Flow:
  1. connector는 prompt source를 문자열 또는 파일 참조로 해석한다.
  2. 파일 참조면 UTF-8 텍스트를 읽는다.
  3. message trigger면 원본 메시지와 prompt를 함께 보존하는 입력 텍스트를 만든다.
  4. reaction trigger면 reaction metadata와 대상 메시지 정보를 포함한 입력 텍스트를 만든다.
- Alternative Flow:
  - prompt가 빈 문자열이면 원본 메시지 또는 reaction context만 사용한다.
- Outputs:
  - `InboundEvent.text`
- Side Effects:
  - file read I/O
- Failure Modes:
  - 파일이 없거나 읽을 수 없음
  - reaction 대상 메시지를 조회할 수 없음

#### Flow ID: SLACK-CONFIG-04

- Actor:
  Slack connector
- Trigger:
  `reaction_added`
- Preconditions:
  - `reactions[reactionName]` 규칙이 설정돼 있다.
- Main Flow:
  1. connector는 reaction name으로 rule을 조회한다.
  2. rule이 `{ action: 'abort' }`면 대상 conversation을 중단한다.
  3. rule이 prompt source면 reaction 전용 turn을 제출한다.
- Alternative Flow:
  - rule이 없으면 이벤트를 무시한다.
- Outputs:
  - `abortConversation()` 호출 또는 reaction `InboundEvent`
- Side Effects:
  - 대상 메시지 lookup
- Failure Modes:
  - conversationId를 복원할 수 없음
  - reaction 대상 메시지가 삭제돼 context를 만들 수 없음

---

## 4. Constraint Specification

### Constraint ID: SLACK-CONFIG-CON-001

- Category:
  Contract
- Description:
  `priority`는 `mention`, `thread`, `channel`만 허용하며 중복되면 안 된다.
- Scope:
  `SLACK-CONFIG-01`, `SLACK-CONFIG-02`
- Measurement:
  시작 시 정규화 함수가 검증한다.
- Verification:
  invalid config unit test
- Related Behavior:
  `SLACK-CONFIG-01`, `SLACK-CONFIG-02`

### Constraint ID: SLACK-CONFIG-CON-002

- Category:
  Safety
- Description:
  `channel` trigger는 기본 비활성 상태여야 하며, 명시적 opt-in 없이는 최상위 채널 메시지를 turn으로 만들면 안 된다.
- Scope:
  전체
- Measurement:
  default config와 runtime behavior 비교
- Verification:
  backward compatibility test + explicit opt-in test
- Related Behavior:
  `SLACK-CONFIG-01`, `SLACK-CONFIG-02`

### Constraint ID: SLACK-CONFIG-CON-003

- Category:
  Reliability
- Description:
  prompt file 읽기 실패는 조용히 빈 prompt로 대체되면 안 된다.
- Scope:
  `SLACK-CONFIG-03`
- Measurement:
  file read error 시 event drop + error log 여부
- Verification:
  missing file unit test
- Related Behavior:
  `SLACK-CONFIG-03`

### Constraint ID: SLACK-CONFIG-CON-004

- Category:
  Compatibility
- Description:
  `triggers`를 생략한 기존 설정은 현재 동작과 의미가 같아야 한다.
- Scope:
  전체
- Measurement:
  legacy config fixture 결과 비교
- Verification:
  compatibility regression test
- Related Behavior:
  `SLACK-CONFIG-01`

---

## 5. Interface Specification

### 5.1 API Contract

```ts
type SlackPromptSource = string | { file: string }

type SlackMessageTriggerKind = 'mention' | 'thread' | 'channel'

type SlackMessageTrigger = SlackPromptSource | false

type SlackReactionRule =
  | SlackPromptSource
  | { action: 'abort' }

type SlackTriggerConfig = {
  priority?: SlackMessageTriggerKind[]
  mention?: SlackMessageTrigger
  thread?: SlackMessageTrigger
  channel?: SlackMessageTrigger
  reactions?: Record<string, SlackReactionRule>
}
```

#### Default Normalized Config

```ts
{
  priority: ['mention', 'thread', 'channel'],
  mention: '',
  thread: '',
  channel: false,
  reactions: {
    x: { action: 'abort' },
  },
}
```

#### Prompt Source Resolution Rules

- `string`
  - inline prompt 텍스트로 사용한다.
- `{ file: string }`
  - UTF-8 텍스트 파일로 읽는다.
  - 상대 경로는 `process.cwd()` 기준으로 해석한다.
- 빈 문자열 `''`
  - trigger는 활성이나 추가 prompt는 없다.

#### Reaction Rule Resolution Rules

- `string | { file }`
  - reaction 전용 turn을 생성한다.
- `{ action: 'abort' }`
  - 해당 conversation의 진행 중 turn을 중단한다.

---

## 6. Realization Specification

- Module Boundaries:
  - `normalizeTriggerConfig(options.triggers)`
  - `selectMessageTrigger(candidates, priority)`
  - `resolvePromptSource(source)`
  - `buildReactionPrompt(rule, event, targetMessage)`
- Data Ownership:
  - connector가 trigger config와 prompt source를 소유한다.
  - Slack 원본 event/message는 `raw`와 lookup 결과에서 읽기 전용으로 사용한다.
- State Model:
  - config는 connector lifetime 동안 immutable snapshot으로 유지한다.
  - dedupe/activeThreads는 runtime mutable state다.
- Concurrency Strategy:
  - 같은 normalized message key에 대한 arbitration은 단일 critical section 안에서 수행한다.
  - reaction은 message trigger arbitration과 별도 key로 dedupe 가능해야 한다.
- Failure Handling:
  - invalid config는 startup failure
  - missing prompt file / target lookup failure는 해당 이벤트만 실패 처리
- Deployment Location:
  - `packages/integrations/slack/connector`
- Observability Plan:
  - selected trigger kind, skipped trigger kinds, prompt source type, reaction rule action을 debug log로 남긴다.
- Migration / Rollback:
  - `triggers` 미사용 기존 설정은 변경 없이 동작한다.
  - 새 설정 도입 후 문제가 생기면 `triggers`를 제거해 기존 동작으로 롤백할 수 있다.

---

## 7. Dependency Map

- Depends On:
  - [connector.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/connector.md)
  - [events.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/events.md)
- Blocks:
  - trigger-aware implementation tests
  - future `sena-ai` Slack connector docs refresh
- Parallelizable With:
  - `mrkdwn.md`
  - `verify.md`

---

## 8. Acceptance Criteria

- Given `triggers.priority = ['thread', 'mention', 'channel']`이고 한 메시지가 `mention`과 `thread`를 동시에 만족할 때 When connector가 처리하면 Then `thread` 하나만 실행된다.
- Given `channel` trigger가 설정되지 않았을 때 When 최상위 일반 채널 메시지가 들어오면 Then turn이 생성되지 않는다.
- Given `mention: { file: './prompts/slack/mention.md' }`일 때 When 멘션 이벤트가 들어오면 Then 파일 내용을 포함한 입력으로 turn이 제출된다.
- Given `reactions.eyes = '이 리액션의 의미를 해석해 응답해줘'`일 때 When `:eyes:` 리액션이 달리면 Then reaction context와 함께 turn이 제출된다.
- Given `reactions.x = { action: 'abort' }`일 때 When `:x:` 리액션이 달리면 Then 해당 conversation의 in-flight turn abort가 시도된다.
- Given `triggers`를 생략한 기존 설정일 때 When app mention / active thread reply / `:x:` reaction이 들어오면 Then 현재 동작과 동일하게 처리된다.
