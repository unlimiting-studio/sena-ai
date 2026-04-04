# Slack Connector

## 한 줄 요약

Slack connector는 입력 모드 등록, trigger 설정 정규화, 공통 출력 계약을 조합해 코어 턴 엔진과 Slack을 연결한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-001`, `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`, `SLACK-CONN-FR-004`, `SLACK-CONN-FR-007`, `SLACK-CONN-FR-008`, `SLACK-CONN-FR-009`
- Related AC: `SLACK-CONN-AC-001`, `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`, `SLACK-CONN-AC-004`, `SLACK-CONN-AC-007`, `SLACK-CONN-AC-008`, `SLACK-CONN-AC-009`

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

- connector 시작 시 `triggers` 설정을 검증한다.
- `triggers`가 없으면 기존 기본값으로 정규화한다.
  - `priority = ['mention', 'thread', 'channel']`
  - `mention = ''`
  - `thread = ''`
  - `channel = false`
  - `reactions = { x: { action: 'abort' } }`
- priority가 없으면 기본 순서를 적용한다.

### `SLACK-C-03` 봇 사용자 ID lazy 해소

- 최초 이벤트 처리 시 `auth.test()`로 봇 user id를 얻어 이후 스레드 복구 판단에 사용한다.

### `SLACK-C-04` 출력 객체 생성

- `createOutput(context)`는 스레드를 activeThreads에 등록하고 진행/결과 렌더러를 반환한다.

## Constraints

- `SLACK-C-C-001`: mode에 따라 `signingSecret`과 `appToken`은 상호 배타적이어야 한다.
- `SLACK-C-C-002`: 입력 처리 경로는 모드와 무관하게 동일한 dedupe/활성 스레드/priority 규칙을 따라야 한다.
- `SLACK-C-C-003`: `triggers` 생략 시 connector는 기존 동작과 호환돼야 한다.
- `SLACK-C-C-004`: channel trigger는 명시적으로 설정되기 전까지 활성화되면 안 된다.

## Interface

- `slackConnector(options: SlackConnectorOptions): Connector`

```ts
type SlackPromptSource = string | { file: string }

type SlackMessageTrigger = SlackPromptSource | false

type SlackReactionRule =
  | SlackPromptSource
  | { action: 'abort' }

type SlackMessageTriggerKind = 'mention' | 'thread' | 'channel'

type SlackTriggerConfig = {
  priority?: SlackMessageTriggerKind[]
  mention?: SlackMessageTrigger
  thread?: SlackMessageTrigger
  channel?: SlackMessageTrigger
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

- `SlackPromptSource`
  - `string`: 인라인 prompt 텍스트
  - `{ file: string }`: UTF-8 파일 참조
- `SlackMessageTrigger`
  - `false`: 해당 trigger 비활성
  - `''` 또는 문자열: trigger 활성, prompt는 해당 문자열(빈 문자열 허용)
- `SlackReactionRule`
  - `string | { file }`: 해당 reaction이 turn을 생성한다.
  - `{ action: 'abort' }`: 해당 reaction이 진행 중 turn을 중단한다.

## Realization

- 모듈 경계:
  - `connector.ts`가 입력/출력/trigger 해석/파일다운로드/캐시를 조립한다.
- 상태 모델:
  - `activeThreads`, `processingEvents`, `processedEvents`, `userNameCache`를 메모리에 유지한다.
- 설정 정규화:
  - trigger 기본값 적용, priority 검증, reaction map 검증을 한곳에서 수행한다.

## Dependencies

- Depends On: [configuration.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/configuration.md), [events.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/events.md), [output.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/output.md), [verify.md](/Users/agent/workspace/repos/sena/packages/integrations/slack/connector/specs/verify.md)
- Blocks: Slack 통합 전체
- Parallelizable With: `tools-slack`

## AC

- Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 시작하면 Then 적절한 입력 등록이 수행된다.
- Given `triggers` 설정이 비어 있을 때 When connector를 시작하면 Then 기존 mention/thread/`:x:` 기본값이 주입된다.
- Given invalid priority 배열이 있을 때 When connector를 초기화하면 Then connector는 조용히 보정하지 않고 설정 오류를 보고한다.
- Given `createOutput()`을 호출할 때 When 같은 스레드의 후속 메시지가 오면 Then active thread 규칙이 적용된다.

## 개편 메모

- 입력 등록 스펙에 trigger 설정 정규화와 backward-compatible defaults를 추가했다.
