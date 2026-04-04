# Relay Durable Object

## 한 줄 요약

Relay Durable Object는 단일 봇의 WebSocket 연결 집합을 유지하고 platform-core relay가 보낸 Slack 이벤트를 브로드캐스트한다.

## 상위 스펙 연결

- 관련 요구사항: `PLATFORM-WORKER-FR-004`, `PLATFORM-WORKER-NFR-001`
- 관련 수용 기준: `PLATFORM-WORKER-AC-004`, `PLATFORM-WORKER-AC-005`

## Behavior

- Trigger:
  `/ws` WebSocket upgrade 또는 `/dispatch` POST 요청이 들어온다.
- Main Flow:
  1. `/ws`는 `WebSocketPair`를 만들고 server socket을 수락해 connection set에 넣는다.
  2. 연결 직후 `connected` 메시지를 보낸다.
  3. `/dispatch`는 Slack 이벤트를 `slack_event` envelope로 감싸 모든 소켓에 브로드캐스트한다.
  4. `webSocketClose`/`webSocketError`는 connection set에서 소켓을 제거한다.
- Failure Modes:
  send 실패한 소켓은 즉시 제거된다.

## Constraints

- `PLATRELAYDO-CON-001`: 각 Durable Object 인스턴스는 단일 봇 연결 집합만 관리한다.
- `PLATRELAYDO-CON-002`: 브로드캐스트 메시지는 `{ type, data, id }` JSON 형태를 유지해야 한다.
- `PLATRELAYDO-CON-003`: hibernation 복원 시 기존 WebSocket을 다시 connection set에 넣어야 한다.

## Interface

- 경로:
  `GET /ws`, `POST /dispatch`
- WebSocket 이벤트:
  `connected`, `slack_event`

## Realization

- `state.getWebSockets()`로 hibernated 연결을 복원한다.
- eventCounter로 dispatch 메시지 ID를 증가시킨다.

## Dependencies

- Depends On:
  Cloudflare Durable Objects runtime
- Blocks:
  platform-core CF relay 구현
- Parallelizable With:
  fetch/scheduled handler

## AC

- Given `/ws` upgrade, When DO가 연결을 수락하면, Then 응답은 WebSocket 101이고 즉시 `connected` 이벤트를 보낸다.
- Given `/dispatch` POST, When 이벤트를 받아 브로드캐스트하면, Then 연결된 모든 소켓이 같은 `slack_event` payload를 받는다.
- Given send 실패나 close/error, When DO가 이를 감지하면, Then 해당 소켓은 connection set에서 제거된다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 섹션 구조와 추적 가능성을 보강했다.
