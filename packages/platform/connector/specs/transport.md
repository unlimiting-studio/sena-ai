# Platform Transport

## 한 줄 요약

플랫폼 connector는 SSE, WebSocket, auto transport를 공통 인터페이스로 추상화한다.

## 상위 스펙 연결

- Related Requirements: `PCONN-FR-004`
- Related AC: `PCONN-AC-004`

## Behavior

### `TRANS-01` SSE transport

- Trigger: `transport: 'sse'`
- Main Flow:
  - EventSource 기반으로 연결한다.
  - 플랫폼 SSE 이벤트를 리스너에 전달한다.

### `TRANS-02` WebSocket transport

- Trigger: `transport: 'websocket'`
- Main Flow:
  - ws/wss URL로 변환해 WebSocket 연결을 맺는다.
  - `{ type, data, id }` 메시지를 파싱해 핸들러에 전달한다.

### `TRANS-03` auto transport

- Trigger: `transport: 'auto'`
- Main Flow:
  - WebSocket을 먼저 시도한다.
  - 426 에러면 SSE로 폴백한다.

## Constraints

- `TRANS-C-001`: transport는 공통 `connect/on/onError/close` 인터페이스를 유지해야 한다.
- `TRANS-C-002`: auto fallback은 426 Upgrade Required인 경우에만 자동 전환해야 한다.

## Interface

- `Transport`
  - `connect()`
  - `on(event, handler)`
  - `onError(handler)`
  - `close()`
- Factories:
  - `createSSETransport(url)`
  - `createWebSocketTransport(url)`
  - `createAutoTransport(url)`

## Realization

- 모듈 경계:
  - `transports/sse.ts`, `websocket.ts`, `auto.ts`
- 상태 모델:
  - auto transport는 현재 활성 transport와 등록된 리스너 목록을 유지한다.

## Dependencies

- Depends On: EventSource/WebSocket runtime
- Blocks: `connector.md`
- Parallelizable With: `platform-core` relay runtime

## AC

- Given SSE transport를 사용할 때 When 플랫폼이 이벤트를 보내면 Then 리스너가 해당 이벤트를 수신한다.
- Given auto transport에서 WebSocket이 426으로 실패할 때 When 연결을 재시도하면 Then SSE로 폴백한다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 상위 스펙 연결, 섹션 구조, 검증 기준을 정리했다.
