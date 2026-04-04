# Slack Connector

## 한 줄 요약

Slack connector는 입력 모드 등록, trigger 설정 정규화, 공통 출력 계약을 조합해 코어 턴 엔진과 Slack을 연결한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-001`, `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`, `SLACK-CONN-FR-004`, `SLACK-CONN-FR-007`, `SLACK-CONN-FR-008`, `SLACK-CONN-FR-009`, `SLACK-CONN-FR-010`, `SLACK-CONN-FR-011`, `SLACK-CONN-FR-012`, `SLACK-CONN-FR-013`, `SLACK-CONN-FR-014`, `SLACK-CONN-FR-015`
- Related AC: `SLACK-CONN-AC-001`, `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`, `SLACK-CONN-AC-004`, `SLACK-CONN-AC-007`, `SLACK-CONN-AC-008`, `SLACK-CONN-AC-009`, `SLACK-CONN-AC-010`, `SLACK-CONN-AC-011`, `SLACK-CONN-AC-012`, `SLACK-CONN-AC-013`, `SLACK-CONN-AC-014`, `SLACK-CONN-AC-015`, `SLACK-CONN-AC-016`, `SLACK-CONN-AC-017`, `SLACK-CONN-AC-018`, `SLACK-CONN-AC-019`, `SLACK-CONN-AC-020`

## Behavior

### `SLACK-C-01` HTTP/Socket Mode 등록

- HTTP 모드:
  - `POST /api/slack/events` 라우트를 등록한다.
  - URL verification challenge를 응답한다.
  - 서명 검증 후 즉시 200 응답하고 비동기로 이벤트를 처리한다.
- Socket Mode:
  - `SocketModeClient`로 `app_mention`, `message`, `reaction_added`를 구독한다.
  - 3초 이내 `ack()` 후 같은 `processSlackEvent` 경로로 보낸다.

### `SLACK-C-02` trigger 설정 정규화

- `triggers`가 없으면 기존 기본값으로 정규화한다.
  - `mention = ''`
  - `thread = ''`
  - `reactions = { x: { action: 'abort' } }`
- `triggers`가 있으면, key가 없는 항목은 비활성으로 본다.
- `triggers: {}`는 legacy default가 아니라 "모든 trigger 비활성"으로 해석한다.
- 기존 mention/thread/`:x:` 동작을 유지한 채 일부 rule만 바꾸고 싶다면 그 key들을 함께 다시 적어야 한다.
- 메시지 계열 trigger 우선순위는 connector가 고정한다.
  - `mention > thread > channel > message`
- `message` trigger는 채널 메시지(thread_ts 없음)와 쓰레드 메시지(봇 참여 여부 무관) 모두 대상이며, 가장 낮은 우선순위다. `thread` key가 활성이면 봇 참여 스레드는 우선순위에서 `thread`가 먼저 선택되므로 중복 실행은 없다.

### `SLACK-C-03` prompt 기준 디렉터리 결정

- prompt source가 `{ file }`면 connector는 파일 기준 디렉터리를 먼저 결정한다.
- 기준은 `config.cwd`가 있으면 그 경로이고, 없으면 `sena.config.ts`가 있는 디렉터리다.

### `SLACK-C-04` filter 및 trigger function 실행

- trigger 필드 자체가 function이면:
  - event를 인자로 호출한다.
  - `false`/`undefined`/`void` 반환 시 해당 candidate/rule을 건너뛴다 (fallthrough).
  - 유효한 값 반환 시 해당 값을 prompt source 및 설정(`thinkingMessage` 등)으로 사용한다.
  - 별도 filter는 실행하지 않는다.
  - throw/reject 시 이벤트 전체를 실패 처리한다.
- trigger 또는 reaction rule에 `filter(event)`가 있으면 실제 액션 전에 호출한다.
- `false`를 반환하면 해당 candidate/rule은 무시한다.
- `true` 또는 `undefined`를 반환하면 통과로 본다.
- filter가 throw/reject하면 해당 이벤트 전체를 실패 처리하고 더 낮은 우선순위 후보로 넘기지 않는다.
- reaction rule filter/function은 reacted message를 먼저 조회해 message context를 채운 뒤 실행한다.

### `SLACK-C-05` 봇 사용자 ID lazy 해소

- 최초 이벤트 처리 시 `auth.test()`로 봇 user id를 얻어 이후 스레드 복구 판단에 사용한다.

### `SLACK-C-06` 출력 객체 생성

- `createOutput(context)`는 스레드를 activeThreads에 등록하고 진행/결과 렌더러를 반환한다.
- trigger-level `thinkingMessage`는 `InboundEvent.raw.thinkingMessage`에 안정된 top-level 필드로 포함된다. 메시지 turn과 reaction turn 모두 동일한 경로를 사용한다. worker가 `InboundEvent.raw`를 `ConnectorOutputContext.metadata`로 전달하므로 turn 단위로 올바르게 수신된다.
- `createOutput`은 `context.metadata.thinkingMessage`에서 resolved 값을 읽는다. 필드가 없으면(`undefined`) 전역 `thinkingMessage`를 사용한다.
- thinkingMessage 결정 우선순위: `context.metadata.thinkingMessage` (trigger-level) > global-level. trigger-level이 `false`이면 전역 설정과 무관하게 thinking message를 전송하지 않는다.

## Constraints

- `SLACK-C-C-001`: mode에 따라 `signingSecret`과 `appToken`은 상호 배타적이어야 한다.
- `SLACK-C-C-002`: 입력 처리 경로는 모드와 무관하게 동일한 dedupe/활성 스레드/고정 우선순위 규칙을 따라야 한다.
- `SLACK-C-C-003`: `triggers` 생략 시 connector는 기존 동작과 호환돼야 한다.
- `SLACK-C-C-004`: `triggers` 객체가 존재할 때 key가 없는 trigger는 활성화되면 안 된다.
- `SLACK-C-C-005`: filter throw/reject는 조용히 통과 처리하면 안 된다.

## Interface

- `slackConnector(options: SlackConnectorOptions): Connector`

```ts
type SlackMessageTriggerEvent = {
  kind: 'mention' | 'thread' | 'channel' | 'message'
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

type SlackMessageTriggerFunctionResult =
  | string
  | { text: string; thinkingMessage?: string | false }
  | { file: string; thinkingMessage?: string | false }
  | false | void

type SlackReactionTriggerFunctionResult =
  | string
  | { text: string; thinkingMessage?: string | false }
  | { file: string; thinkingMessage?: string | false }
  | { abort: true }
  | false | void

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
  channel?: SlackMessagePromptTrigger
  message?: SlackMessagePromptTrigger
  reactions?: Record<string, SlackReactionRule>
}

type SlackConnectorOptions = {
  appId: string
  botToken: string
  thinkingMessage?: string | false
  triggers?: SlackTriggerConfig
} & (
  | { mode?: 'http'; signingSecret: string; appToken?: never }
  | { mode: 'socket'; appToken: string; signingSecret?: never }
)
```

## Realization

- 모듈 경계:
  - `connector.ts`가 입력/출력/trigger 해석/파일다운로드/캐시를 조립한다.
- 상태 모델:
  - `activeThreads`, `processingEvents`, `processedEvents`, `userNameCache`를 메모리에 유지한다.
- 설정 정규화:
  - legacy default 적용, omit=disabled 해석, 기준 디렉터리 결정, reaction map 검증을 한곳에서 수행한다.
- trigger 선택:
  - 메시지 계열은 고정 순서 `mention > thread > channel > message`로만 중재한다.
- filter/function 평가:
  - trigger 필드가 function이면 event를 인자로 호출하고, 반환값으로 prompt source와 설정을 결정한다. 별도 filter는 실행하지 않는다.
  - trigger 필드가 object이면 메시지 계열은 `SlackMessageTriggerEvent`, reaction은 `SlackReactionTriggerEvent`를 만들어 각 rule의 filter를 평가한다.
  - reaction은 reacted message lookup 이후 `SlackReactionTriggerEvent`로 평가한다.
  - reaction의 `threadTs`는 lookup 뒤 항상 채우고, 최상위 메시지 reaction이면 `ts`와 같은 값을 넣는다.
- thinkingMessage 결정:
  - trigger-level `thinkingMessage` (object 필드 또는 function 반환값) > 전역 `thinkingMessage`.

## Dependencies

- Depends On: [configuration.md](./configuration.md), [events.md](./events.md), [output.md](./output.md), [verify.md](./verify.md)
- Blocks: Slack 통합 전체
- Parallelizable With: `tools-slack`

## AC

- Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 시작하면 Then 적절한 입력 등록이 수행된다.
- Given `triggers` 설정이 아예 없을 때 When connector를 시작하면 Then 기존 mention/thread/`:x:` 기본값이 주입된다.
- Given `triggers: { mention: '...' }`만 있을 때 When thread 또는 channel 이벤트가 와도 Then 해당 key가 없으므로 실행되지 않는다.
- Given `triggers: {}`일 때 When connector를 시작하면 Then 기존 mention/thread/`:x:` 기본값은 주입되지 않는다.
- Given `{ file: './prompts/slack/mention.md' }` prompt source가 있을 때 When connector가 초기화되면 Then 기준 디렉터리는 `config.cwd` 우선, 없으면 `sena.config.ts` 디렉터리로 결정된다.
- Given `filter(event)`가 `false`를 반환할 때 When 해당 candidate를 평가하면 Then 그 candidate는 무시된다.
- Given reaction filter가 `event.text`를 읽을 때 When connector가 reaction을 처리하면 Then reacted message 조회 뒤 채워진 값이 전달된다.
- Given reacted message가 봇 메시지일 때 When reaction filter가 실행되면 Then 작성자 정보는 `messageUserId` 대신 `messageBotId`로 전달된다.
- Given `filter(event)`가 throw할 때 When connector가 처리하면 Then 이벤트는 실패 처리되고 하위 우선순위 후보로 넘어가지 않는다.
- Given `createOutput()`을 호출할 때 When 같은 스레드의 후속 메시지가 오면 Then active thread 규칙이 적용된다.
- Given `mention: { text: '...', thinkingMessage: '분석 중...' }`이고 전역 `thinkingMessage: '잠시만요'`일 때 When 멘션 이벤트가 처리되면 Then 출력 객체에 '분석 중...'이 전달된다.
- Given `message` trigger가 설정됐을 때 When 봇 미참여 쓰레드 메시지가 들어오면 Then `message` trigger로 처리된다.
- Given `mention: (event) => ({ file: './dynamic.md' })`일 때 When 멘션 이벤트가 들어오면 Then function 반환값의 file을 프롬프트로 사용한다.
- Given trigger function이 throw할 때 When 이벤트가 처리되면 Then 이벤트는 실패 처리되고 하위 우선순위 후보로 넘어가지 않는다.

## 개편 메모

- 입력 등록 스펙에 omit=disabled와 per-trigger filter 규칙을 추가했다.
