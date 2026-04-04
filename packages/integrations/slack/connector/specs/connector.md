# Slack Connector

## 한 줄 요약

Slack connector는 두 입력 모드와 공통 출력 계약을 조합해 코어 턴 엔진과 Slack을 연결한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-001`, `SLACK-CONN-FR-002`, `SLACK-CONN-FR-003`, `SLACK-CONN-FR-004`
- Related AC: `SLACK-CONN-AC-001`, `SLACK-CONN-AC-002`, `SLACK-CONN-AC-003`, `SLACK-CONN-AC-004`

## Behavior

### `SLACK-C-01` HTTP/Socket Mode 등록

- HTTP 모드:
  - `POST /api/slack/events` 라우트를 등록한다.
  - URL verification challenge를 응답한다.
  - 서명 검증 후 즉시 200 응답하고 비동기로 이벤트를 처리한다.
- Socket Mode:
  - `SocketModeClient`로 `app_mention`, `message`, `reaction_added`를 구독한다.
  - 3초 이내 `ack()` 후 같은 `processSlackEvent` 경로로 보낸다.

### `SLACK-C-02` 봇 사용자 ID lazy 해소

- 최초 이벤트 처리 시 `auth.test()`로 봇 user id를 얻어 이후 스레드 복구 판단에 사용한다.

### `SLACK-C-03` 출력 객체 생성

- `createOutput(context)`는 스레드를 activeThreads에 등록하고 진행/결과 렌더러를 반환한다.

## Constraints

- `SLACK-C-C-001`: mode에 따라 `signingSecret`과 `appToken`은 상호 배타적이어야 한다.
- `SLACK-C-C-002`: 입력 처리 경로는 모드와 무관하게 동일한 dedupe/활성 스레드 규칙을 따라야 한다.

## Interface

- `slackConnector(options: SlackConnectorOptions): Connector`
- `SlackConnectorOptions`
  - `appId`
  - `botToken`
  - `thinkingMessage?`
  - `mode?: 'http' | 'socket'`
  - `signingSecret?`
  - `appToken?`

## Realization

- 모듈 경계:
  - `connector.ts`가 입력/출력/파일다운로드/캐시를 조립한다.
- 상태 모델:
  - `activeThreads`, `processingEvents`, `processedEvents`, `userNameCache`를 메모리에 유지한다.

## Dependencies

- Depends On: [events.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/events.md), [output.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/output.md), [verify.md](/Users/channy/workspace/sena-ai/packages/integrations/slack/connector/specs/verify.md)
- Blocks: Slack 통합 전체
- Parallelizable With: `tools-slack`

## AC

- Given HTTP 또는 Socket Mode 설정이 있을 때 When connector를 시작하면 Then 적절한 입력 등록이 수행된다.
- Given `createOutput()`을 호출할 때 When 같은 스레드의 후속 메시지가 오면 Then active thread 규칙이 적용된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 책임 범위와 하위 스펙 링크를 명시했다.
