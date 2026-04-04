# Platform Connector

## 한 줄 요약

플랫폼 릴레이 이벤트를 코어 턴 실행으로 연결하고, 출력은 플랫폼 API proxy를 통해 Slack에 전송한다.

## 상위 스펙 연결

- Related Requirements: `PCONN-FR-001`, `PCONN-FR-002`, `PCONN-FR-003`, `PCONN-NFR-001`
- Related AC: `PCONN-AC-001`, `PCONN-AC-002`, `PCONN-AC-003`

## Behavior

### `PCONN-CONN-01` 연결 수립

- Trigger: `registerRoutes(server, turnEngine)`
- Main Flow:
  - transport를 생성하고 `/relay/stream?connect_key=...`에 연결한다.
  - `connected` 이벤트는 로그/상태 확인 용도로만 사용한다.

### `PCONN-CONN-02` inbound event 변환

- Trigger: `slack_event`
- Main Flow:
  - bot 메시지와 subtype 메시지를 필터링한다.
  - `app_mention`과 `message`만 `InboundEvent`로 변환한다.
  - `conversationId`는 `{channel}:{thread_ts}` 규칙을 따른다.

### `PCONN-CONN-03` output 전송

- Trigger: `createOutput(context)` 이후 `showProgress/sendResult/sendError`
- Main Flow:
  - `conversationId`에서 channel/thread_ts를 복원한다.
  - 모든 Slack API 호출을 `/relay/api`에 위임한다.
  - thinking message가 있으면 최초 `chat.postMessage` 후 최종 결과에서 `chat.update`를 사용한다.

## Constraints

- `PCONN-CONN-C-001`: `x-connect-key` 인증 없이 Slack API proxy를 호출하면 안 된다.
- `PCONN-CONN-C-002`: 메시지 subtype은 현재 무시 정책을 유지해야 한다.
- `PCONN-CONN-C-003`: `stop()`은 활성 transport를 정리해야 한다.

## Interface

- `platformConnector(options: PlatformConnectorOptions): Connector`
- `PlatformConnectorOptions`
  - `platformUrl`
  - `connectKey`
  - `thinkingMessage?`
  - `transport?`

## Realization

- 모듈 경계:
  - `connector.ts`는 event mapping과 output proxy를 담당한다.
- 상태 모델:
  - transport 인스턴스와 thinking message timestamp를 관리한다.

## Dependencies

- Depends On: `transport.md`, platform relay/api contract
- Blocks: 플랫폼 기반 bot runtime
- Parallelizable With: `platform/core/relay.md`

## AC

- Given `slack_event`가 들어올 때 When connector가 이를 처리하면 Then 적격 이벤트만 `InboundEvent`로 turn engine에 전달된다.
- Given output이 필요할 때 When connector output 메서드를 호출하면 Then platform `/relay/api` 경유로 Slack 메시지가 전송된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

