# Slack Connector Configuration

## 1. 한 줄 요약 (Outcome Statement)

Slack connector 설정은 어떤 Slack 입력이 turn을 만들지, 겹치는 메시지 이벤트 중 무엇을 하나만 실행할지, 그리고 각 trigger에 어떤 prompt source와 filter를 붙일지를 선언한다.

---

## 2. 상위 스펙 연결 (Traceability)

- Related Goals:
  - 하드코딩된 Slack 반응 규칙을 선언형 설정으로 확장한다.
  - 하나의 사용자 액션에서 중복 turn 생성 없이 고정 우선순위로 하나만 실행한다.
  - trigger별 예외 처리를 설정 안에서 직접 선언한다.
- Related Requirements (FR/NFR ID):
  - `SLACK-CONN-FR-002`
  - `SLACK-CONN-FR-003`
  - `SLACK-CONN-FR-007`
  - `SLACK-CONN-FR-008`
  - `SLACK-CONN-FR-009`
  - `SLACK-CONN-FR-010`
  - `SLACK-CONN-FR-011`
  - `SLACK-CONN-FR-012`
  - `SLACK-CONN-FR-013`
  - `SLACK-CONN-FR-014`
  - `SLACK-CONN-FR-015`
  - `SLACK-CONN-FR-016`
  - `SLACK-CONN-NFR-002`
- Related AC:
  - `SLACK-CONN-AC-002`
  - `SLACK-CONN-AC-003`
  - `SLACK-CONN-AC-007`
  - `SLACK-CONN-AC-008`
  - `SLACK-CONN-AC-009`
  - `SLACK-CONN-AC-010`
  - `SLACK-CONN-AC-011`
  - `SLACK-CONN-AC-012`
  - `SLACK-CONN-AC-013`
  - `SLACK-CONN-AC-014`
  - `SLACK-CONN-AC-015`
  - `SLACK-CONN-AC-016`
  - `SLACK-CONN-AC-017`
  - `SLACK-CONN-AC-018`
  - `SLACK-CONN-AC-019`
  - `SLACK-CONN-AC-020`
  - `SLACK-CONN-AC-021`
  - `SLACK-CONN-AC-022`
  - `SLACK-CONN-AC-023`

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
  1. 작성자는 `mention`, `thread`, `directMessage`, `channel`, `message`, `reactions` 규칙을 선언한다.
  2. `triggers` 전체가 없으면 connector는 legacy default를 채운다.
  3. `triggers` 객체가 있으면 key가 없는 항목은 비활성으로 본다.
  4. `triggers: {}`는 "아무 trigger도 켜지지 않음"을 뜻하며 legacy default를 다시 채우지 않는다.
  5. 기존 mention/thread/`:x:` 동작을 유지한 채 일부 rule만 바꾸고 싶다면 해당 key들을 함께 다시 선언해야 한다.
  6. invalid reaction rule 형식이면 시작 시점에 오류를 낸다.
- Outputs:
  - 정규화된 `SlackTriggerConfig`
- Failure Modes:
  - reaction rule 형식이 prompt source 또는 control action 규칙을 만족하지 않음

#### Flow ID: SLACK-CONFIG-02

- Actor:
  Slack connector
- Trigger:
  하나의 Slack message event가 `mention`, `thread`, `directMessage`, `channel`, `message` 후보를 동시에 만족함
- Preconditions:
  - 5개 trigger 중 둘 이상이 설정상 활성이다.
- Main Flow:
  1. connector는 해당 raw 이벤트에서 message trigger 후보 목록을 만든다.
  2. 고정 우선순위 `mention > thread > directMessage > channel > message`에 따라 후보를 순서대로 평가한다.
  3. 각 후보의 filter가 통과하면 그 후보를 선택한다.
  4. 선택되지 않은 나머지 trigger는 실행하지 않는다.
- Alternative Flow:
  - 앞선 후보 filter가 `false`면 더 낮은 우선순위 후보를 계속 평가한다.
  - 후보가 없거나 전부 filter에서 걸리면 이벤트를 무시한다.
- Outputs:
  - 정확히 하나의 selected trigger 또는 `null`
- Failure Modes:
  - filter throw/reject

#### Flow ID: SLACK-CONFIG-03

- Actor:
  Slack connector
- Trigger:
  선택된 trigger가 turn 생성을 요구함
- Preconditions:
  - selected trigger 또는 reaction rule이 prompt source를 가짐
- Main Flow:
  1. trigger 필드가 function이었으면, `SLACK-CONFIG-04`에서 같은 Slack 이벤트 처리 중 이미 호출하여 얻은 반환값을 그대로 사용한다. 같은 이벤트 내에서 function을 다시 호출하지 않는다.
  2. connector는 prompt source를 문자열, `{ text }`, `{ file }` 중 하나로 해석한다.
  3. 파일 참조면 기준 디렉터리를 `config.cwd` 우선, 없으면 `sena.config.ts` 디렉터리로 결정한다.
  4. 파일을 UTF-8 텍스트로 읽는다.
  5. message trigger면 원본 메시지와 prompt를 함께 보존하는 입력 텍스트를 만든다.
  6. reaction trigger면 reaction metadata와 대상 메시지 정보를 포함한 입력 텍스트를 만든다.
- Failure Modes:
  - 파일이 없거나 읽을 수 없음
  - reaction 대상 메시지를 조회할 수 없음
  - trigger function 반환값 shape이 유효하지 않음

#### Flow ID: SLACK-CONFIG-04

- Actor:
  Slack connector
- Trigger:
  trigger 또는 reaction rule에 `filter(event)`가 선언돼 있거나, trigger 필드 자체가 function임
- Preconditions:
  - 정규화된 `SlackMessageTriggerEvent` 또는 `SlackReactionTriggerEvent`를 만들 수 있다.
- Main Flow:
  1. trigger 필드 자체가 function이면:
     - connector는 rule 종류에 맞는 event를 만들어 function을 호출한다. 하나의 Slack 이벤트 처리 내에서 동일 function을 두 번 호출하지 않는다 — 이 호출의 반환값을 그대로 `SLACK-CONFIG-03` prompt resolution에 전달한다. 서로 다른 Slack 이벤트는 매번 독립적으로 function을 호출한다.
     - `false`/`undefined`/`void` 반환 시 해당 candidate/rule을 건너뛴다.
     - 유효한 반환값이면 해당 값을 prompt source 및 설정으로 사용한다 (filter는 별도로 실행하지 않음).
     - 유효한 반환값의 shape은 다음 disjoint union이다:
       - `string` — inline prompt.
       - `{ text: string; thinkingMessage?: string | false }` — inline prompt 명시형.
       - `{ file: string; thinkingMessage?: string | false }` — 파일 참조 prompt.
       - `{ abort: true }` — (reaction 전용) abort action. abort 경로에서는 `ConnectorOutput`을 생성하지 않으므로 `thinkingMessage`는 허용하지 않는다.
       - 위 케이스 외의 shape은 유효하지 않으며 해당 이벤트를 실패 처리한다.
  2. trigger 필드가 object이고 `filter(event)`가 선언돼 있으면:
     - connector는 rule 종류에 맞는 filter event를 만든다.
     - filter를 호출한다.
     - `false`면 해당 candidate/rule을 무시한다.
     - `true` 또는 `undefined`면 통과로 본다.
- Alternative Flow:
  - 메시지 계열 trigger에서 filter가 `false`이거나 function이 skip을 반환하면 다음 우선순위 후보를 계속 평가한다.
  - reaction rule에서 filter가 `false`이거나 function이 skip을 반환하면 그 rule은 무시한다.
- Failure Modes:
  - filter throw/reject 시 이벤트 drop
  - trigger function throw/reject 시 이벤트 drop

#### Flow ID: SLACK-CONFIG-05

- Actor:
  Slack connector
- Trigger:
  `reaction_added`
- Preconditions:
  - `reactions[reactionName]` 규칙이 설정돼 있다.
- Main Flow:
  1. connector는 reaction name으로 rule을 조회한다.
  2. reacted message와 thread 정보를 먼저 조회해 reaction filter용 message context를 보강한다.
  3. rule.filter가 있으면 보강된 `SlackReactionTriggerEvent`로 평가한다.
  4. rule이 `{ action: 'abort' }`면 대상 conversation을 중단한다.
  5. rule이 prompt source면 reaction 전용 turn을 제출한다.
- Alternative Flow:
  - rule이 없거나 filter가 `false`면 이벤트를 무시한다.
- Outputs:
  - `abortConversation()` 호출 또는 reaction `InboundEvent`

---

## 4. Constraint Specification

### Constraint ID: SLACK-CONFIG-CON-001

- Category:
  Contract
- Description:
  메시지 계열 trigger 우선순위는 `mention > thread > directMessage > channel > message`로 고정되며 사용자 설정으로 바꾸지 않는다.
- Scope:
  `SLACK-CONFIG-02`
- Verification:
  overlap selection unit test

### Constraint ID: SLACK-CONFIG-CON-002

- Category:
  Safety
- Description:
  `directMessage`, `channel`, `message` trigger는 기본 비활성 상태여야 하며, 명시적 opt-in(`directMessage`, `channel`, `message` key 선언) 없이는 Slack direct message나 최상위 채널 메시지를 turn으로 만들면 안 된다.
- Scope:
  전체
- Verification:
  backward compatibility test + explicit opt-in test

### Constraint ID: SLACK-CONFIG-CON-003

- Category:
  Reliability
- Description:
  prompt file 읽기 실패는 조용히 빈 prompt로 대체되면 안 된다.
- Scope:
  `SLACK-CONFIG-03`
- Verification:
  missing file unit test

### Constraint ID: SLACK-CONFIG-CON-004

- Category:
  Compatibility
- Description:
  `triggers` 옵션 자체를 생략한 기존 설정은 현재 동작과 의미가 같아야 한다.
- Scope:
  전체
- Verification:
  compatibility regression test

### Constraint ID: SLACK-CONFIG-CON-005

- Category:
  Path Resolution
- Description:
  file prompt 기준 디렉터리는 `config.cwd`를 우선 사용하고, 없으면 `sena.config.ts`가 있는 디렉터리를 사용해야 한다.
- Scope:
  `SLACK-CONFIG-03`
- Verification:
  cwd present / cwd absent test fixture

### Constraint ID: SLACK-CONFIG-CON-006

- Category:
  Shape
- Description:
  `triggers` 객체가 존재할 때 key가 없는 trigger는 비활성으로 해석해야 하며 `false` 같은 별도 disable sentinel은 요구하지 않는다. 이 규칙은 `{}`에도 동일하게 적용된다.
- Scope:
  `SLACK-CONFIG-01`
- Verification:
  omit=disabled unit test

### Constraint ID: SLACK-CONFIG-CON-007

- Category:
  Failure Handling
- Description:
  filter throw/reject 또는 trigger function throw/reject는 silent pass로 처리하면 안 되며, 해당 이벤트를 실패 처리해야 한다.
- Scope:
  `SLACK-CONFIG-04`, `SLACK-CONFIG-05`
- Verification:
  filter/function error unit test

### Constraint ID: SLACK-CONFIG-CON-008

- Category:
  Contract
- Description:
  trigger-level `thinkingMessage`는 전역 `thinkingMessage`보다 항상 우선한다. trigger-level이 `false`이면 해당 trigger에서 thinking message를 전송하지 않는다.
- Scope:
  `SLACK-CONFIG-03`, `SLACK-CONFIG-04`
- Verification:
  thinkingMessage override unit test

### Constraint ID: SLACK-CONFIG-CON-009

- Category:
  Contract
- Description:
  trigger function의 반환값 shape이 유효하지 않으면 해당 이벤트를 실패 처리해야 한다. 유효한 반환값은 `string`, `{ text: string }`, `{ file: string }` (이들에 `thinkingMessage`가 추가된 형태 포함), 또는 `{ abort: true }` (reaction 전용, `thinkingMessage` 불허)다.
- Scope:
  `SLACK-CONFIG-03`, `SLACK-CONFIG-04`
- Verification:
  function return shape validation unit test

---

## 5. Interface Specification

### 5.1 API Contract

```ts
type SlackMessageTriggerEvent = {
  kind: 'mention' | 'thread' | 'directMessage' | 'channel' | 'message'
  channelId: string
  userId: string
  userName?: string
  text: string
  ts: string
  threadTs?: string
  files?: Array<{ id?: string; name?: string; mimeType?: string }>
  raw: unknown
}

type SlackReactionTriggerEvent = {
  kind: 'reaction'
  channelId: string
  userId: string
  userName?: string
  messageUserId?: string
  messageUserName?: string
  messageBotId?: string
  text: string
  ts: string
  threadTs: string
  reaction: string
  files?: Array<{ id?: string; name?: string; mimeType?: string }>
  raw: unknown
}

type SlackMessageTriggerFilter = (
  event: SlackMessageTriggerEvent,
) => boolean | void | Promise<boolean | void>

type SlackReactionTriggerFilter = (
  event: SlackReactionTriggerEvent,
) => boolean | void | Promise<boolean | void>

// trigger function 반환 타입
type SlackMessageTriggerFunctionResult =
  | string                                          // inline prompt
  | { text: string; thinkingMessage?: string | false }
  | { file: string; thinkingMessage?: string | false }
  | false | void                                    // skip (fallthrough)

type SlackReactionTriggerFunctionResult =
  | string                                          // inline prompt
  | { text: string; thinkingMessage?: string | false }
  | { file: string; thinkingMessage?: string | false }
  | { abort: true }
  | false | void                                    // skip

// trigger function 타입
type SlackMessageTriggerFunction = (
  event: SlackMessageTriggerEvent,
) => SlackMessageTriggerFunctionResult | Promise<SlackMessageTriggerFunctionResult>

type SlackReactionTriggerFunction = (
  event: SlackReactionTriggerEvent,
) => SlackReactionTriggerFunctionResult | Promise<SlackReactionTriggerFunctionResult>

type SlackMessagePromptTrigger =
  | string
  | { text: string; filter?: SlackMessageTriggerFilter; thinkingMessage?: string | false }
  | { file: string; filter?: SlackMessageTriggerFilter; thinkingMessage?: string | false }
  | SlackMessageTriggerFunction

type SlackReactionPromptTrigger =
  | string
  | { text: string; filter?: SlackReactionTriggerFilter; thinkingMessage?: string | false }
  | { file: string; filter?: SlackReactionTriggerFilter; thinkingMessage?: string | false }
  | SlackReactionTriggerFunction

type SlackReactionRule =
  | SlackReactionPromptTrigger
  | { action: 'abort'; filter?: SlackReactionTriggerFilter }

type SlackTriggerConfig = {
  mention?: SlackMessagePromptTrigger
  thread?: SlackMessagePromptTrigger
  directMessage?: SlackMessagePromptTrigger
  channel?: SlackMessagePromptTrigger
  message?: SlackMessagePromptTrigger
  reactions?: Record<string, SlackReactionRule>
}
```

#### Default Normalized Config

```ts
// triggers가 아예 없을 때만 적용
{
  mention: '',
  thread: '',
  reactions: {
    x: { action: 'abort' },
  },
}
```

#### Omit Rules

- `triggers` 전체가 없으면 legacy default를 적용한다.
- `triggers` 객체가 있으면 key가 없는 항목은 비활성이다.
- `triggers: {}`는 "모든 trigger 비활성"이다.
- `false` 같은 별도 disable 값은 요구하지 않는다.
- 기존 mention/thread/`:x:` 동작을 유지하면서 일부 rule만 바꾸려면 그 key들을 함께 다시 적어야 한다.

#### Message Trigger Selection Rules

- 고정 순서 `mention > thread > directMessage > channel > message`로 선택한다.
- 이 순서는 설정으로 override하지 않는다.
- 한 normalized message key에서는 최대 하나만 실행한다.
- 앞선 후보 filter가 `false`이거나 trigger function이 skip을 반환하면 다음 후보를 계속 평가한다.
- `directMessage` 후보는 Slack 1:1 DM 채널(`channel_type = 'im'`, fallback으로 channel id prefix `D`) 메시지를 대상으로 한다. 최상위 메시지와 DM 내부 후속 답글 모두 포함한다.
- `channel` 후보는 direct message를 제외한 최상위 일반 채널 메시지(`thread_ts` 없음)를 대상으로 한다.
- `message` 후보는 채널 메시지, direct message, 쓰레드 메시지(봇 참여 여부 무관) 모두를 대상으로 한다. `thread` key가 활성이면 봇 참여 스레드는 우선순위에서 `thread`가 먼저 선택되므로 중복 실행은 없다. `directMessage` key가 활성이면 DM에서는 `directMessage`가 먼저 선택된다.

#### Prompt Source Resolution Rules

- `string`
  - inline prompt 텍스트로 사용한다.
- `{ text: string }`
  - inline prompt 텍스트를 명시형으로 사용한다.
- `{ file: string }`
  - UTF-8 텍스트 파일로 읽는다.
  - 상대 경로는 `config.cwd`를 우선 기준으로, 없으면 `sena.config.ts` 디렉터리 기준으로 해석한다.
- `function`
  - event를 인자로 호출한다. 반환값은 disjoint union이며, 각 케이스는 다음과 같다:
  - `false`/`undefined`/`void` 반환 시 해당 trigger를 건너뛴다 (fallthrough).
  - `string` 반환 시 inline prompt로 사용한다.
  - `{ text: string; thinkingMessage?: string | false }` 반환 시 inline prompt 명시형으로 사용한다.
  - `{ file: string; thinkingMessage?: string | false }` 반환 시 파일 참조로 해석한다.
  - `{ abort: true }` 반환 시 (reaction 전용) abort action으로 처리한다. abort 경로에서는 `thinkingMessage`를 허용하지 않는다.
  - 위 케이스 외의 shape은 유효하지 않으며 해당 이벤트를 실패 처리한다.

#### thinkingMessage Resolution Rules

- trigger-level `thinkingMessage`가 존재하면 (object 필드 또는 function 반환값) 전역 설정보다 우선한다.
- trigger-level이 `false`이면 해당 trigger에서 thinking message를 전송하지 않는다.
- trigger-level이 `string`이면 해당 문자열을 thinking message로 전송한다.
- trigger-level이 없으면 전역 `thinkingMessage` 설정을 따른다.
- resolved thinkingMessage는 `InboundEvent.raw.thinkingMessage`에 안정된 top-level 필드로 포함된다. 메시지 turn과 reaction turn 모두 동일한 경로를 사용한다. worker가 `ConnectorOutputContext.metadata`를 통해 turn 단위로 `createOutput`에 전달하므로, `context.metadata.thinkingMessage`로 수신된다. 이로써 pending event가 steer에 흡수되더라도 이후 turn이 잘못된 thinkingMessage를 사용하지 않는다.

#### Filter Rules

- message trigger filter 인자는 현재 평가 중인 메시지 기준 정보(`channelId`, `userId`, `text`, `ts`, `threadTs`, `files`, `raw`)를 담은 `SlackMessageTriggerEvent`다.
- reaction rule filter 인자는 connector가 reacted message를 먼저 조회해 만든 `SlackReactionTriggerEvent`다.
- `userId`/`userName`은 message trigger와 reaction rule 모두 "액션을 발생시킨 사람" 기준이다.
- reaction rule에서는 reacted message 작성자를 `messageUserId`/`messageUserName`으로 별도 제공하고, 봇 메시지면 `messageBotId`를 사용한다.
- reaction rule의 `threadTs`는 lookup 이후 항상 채워져야 하며, 최상위 메시지 reaction이면 `ts`와 같은 값을 넣는다.
- `false`를 반환하면 해당 candidate/rule은 무시한다.
- `true` 또는 `undefined`를 반환하면 통과다.
- throw/reject면 이벤트를 실패 처리한다.
- trigger 필드 자체가 function인 경우, filter와 function은 별개다. function은 filter 역할과 prompt source 결정을 동시에 수행하므로 별도 filter는 실행하지 않는다.

---

## 6. Realization Specification

- Module Boundaries:
  - `normalizeTriggerConfig(options.triggers)`
  - `selectMessageTrigger(candidates)`
  - `isDirectMessageChannel(event)` — `channel_type = 'im'` 우선, 없으면 channel id prefix `D`로 DM 판별
  - `resolvePromptSource(source, baseDir)`
  - `resolveTriggerFunction(fn, event)` — trigger function 호출 및 반환값 검증
  - `resolveThinkingMessage(triggerLevel, globalLevel)` — thinkingMessage 우선순위 결정
  - `buildTriggerEvent(candidate, rawEvent)`
  - `runTriggerFilter(filter, event)`
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
  - filter throw/reject는 해당 이벤트 전체를 drop
- Observability Plan:
  - selected trigger kind, skipped trigger kinds, prompt source type, filter result, filter error, resolved prompt base directory를 debug log로 남긴다.
- Migration / Rollback:
  - `triggers` 미사용 기존 설정은 변경 없이 동작한다.
  - `triggers: {}` 또는 부분 `triggers` 설정은 누락 key를 자동 보존하지 않는다.
  - 새 설정 도입 후 문제가 생기면 `triggers`를 제거해 기존 동작으로 롤백할 수 있다.

---

## 7. Dependency Map

- Depends On:
  - [connector.md](./connector.md)
  - [events.md](./events.md)
- Blocks:
  - trigger-aware implementation tests
  - future `sena-ai` Slack connector docs refresh
- Parallelizable With:
  - [mrkdwn.md](./mrkdwn.md)
  - [verify.md](./verify.md)

---

## 8. Acceptance Criteria

- Given 한 메시지가 `mention`과 `thread`를 동시에 만족할 때 When connector가 처리하면 Then 고정 우선순위에 따라 `mention` 하나만 실행된다.
- Given `triggers: { mention: '...' }`일 때 When thread 또는 channel 이벤트가 들어오면 Then 해당 key가 없으므로 실행되지 않는다.
- Given mention filter가 `false`를 반환하고 thread filter는 통과할 때 When 같은 메시지가 mention과 thread를 동시에 만족하면 Then thread가 실행된다.
- Given mention filter가 throw할 때 When 같은 메시지가 mention과 thread를 동시에 만족하면 Then 이벤트는 실패 처리되고 thread로 내려가지 않는다.
- Given `mention: { file: './prompts/slack/mention.md' }`이고 `config.cwd`가 있을 때 When 멘션 이벤트가 들어오면 Then 파일은 `config.cwd` 기준으로 해석된다.
- Given `mention: { file: './prompts/slack/mention.md' }`이고 `config.cwd`가 없을 때 When 멘션 이벤트가 들어오면 Then 파일은 `sena.config.ts`가 있는 디렉터리 기준으로 해석된다.
- Given `reactions.eyes = { text: '이 리액션의 의미를 해석해 응답해줘', filter }`일 때 When `:eyes:` 리액션이 달리면 Then filter 통과 시에만 reaction context와 함께 turn이 제출된다.
- Given reaction filter가 `event.text`와 `event.threadTs`를 읽을 때 When connector가 `reaction_added`를 처리하면 Then filter 전에 reacted message 조회가 수행된 값이 전달된다.
- Given reacted message가 봇 메시지일 때 When reaction filter event를 만들면 Then `messageUserId` 대신 `messageBotId`로 작성자 정보가 전달된다.
- Given `reactions.x = { action: 'abort' }`일 때 When `:x:` 리액션이 달리면 Then 해당 conversation의 in-flight turn abort가 시도된다.
- Given `triggers`를 생략한 기존 설정일 때 When app mention / active thread reply / `:x:` reaction이 들어오면 Then 현재 동작과 동일하게 처리된다.
- Given `triggers: {}`일 때 When Slack 이벤트가 들어오면 Then legacy default는 주입되지 않고 설정된 trigger가 없으므로 실행되지 않는다.
- Given `mention: { text: '...', thinkingMessage: '분석 중...' }`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 멘션 이벤트가 들어오면 Then '분석 중...'이 thinking message로 전송된다.
- Given `mention: { text: '...', thinkingMessage: false }`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 멘션 이벤트가 들어오면 Then thinking message가 전송되지 않는다.
- Given `message` trigger가 설정됐을 때 When 봇 미참여 쓰레드 메시지가 들어오면 Then `message` trigger가 실행된다.
- Given `directMessage` trigger가 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage` trigger가 실행된다.
- Given `directMessage`와 `message` trigger가 모두 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `directMessage`가 우선 실행된다.
- Given `channel` trigger만 설정됐을 때 When Slack 1:1 DM 채널 메시지가 들어오면 Then `channel` trigger는 실행되지 않는다.
- Given `message`와 `channel` trigger가 모두 설정됐을 때 When 최상위 채널 메시지가 들어오면 Then `channel`이 우선 실행된다.
- Given `mention: (event) => ({ file: './custom.md' })`일 때 When 멘션 이벤트가 들어오면 Then function 반환값의 file을 프롬프트로 사용한다.
- Given `mention: (event) => false`일 때 When 멘션 이벤트가 들어오면 Then mention은 건너뛰고 다음 우선순위 후보를 평가한다.
- Given `mention: (event) => '동적 프롬프트'`일 때 When 멘션 이벤트가 들어오면 Then 반환된 문자열을 inline prompt로 사용한다.
- Given `reactions.eyes: (event) => ({ abort: true })`일 때 When `:eyes:` reaction이 달리면 Then abort가 실행된다.
- Given trigger function이 throw할 때 When 이벤트가 들어오면 Then 이벤트는 실패 처리되고 하위 우선순위 후보로 넘어가지 않는다.
