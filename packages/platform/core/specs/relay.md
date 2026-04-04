# Relay & API Proxy

## 한 줄 요약

릴레이는 로컬 봇 런타임과 플랫폼을 연결하고, Slack 이벤트 전달과 Slack API 프록시를 담당한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-001`, `PLATFORM-FR-002`, `PLATFORM-FR-005`
- Related AC: `PLATFORM-AC-001`, `PLATFORM-AC-002`, `PLATFORM-AC-005`

## Behavior

### `PLATFORM-RELAY-01` 봇 연결 수립

- Trigger: `GET /relay/stream?connect_key=...`
- Main Flow:
  - connect key로 active 봇을 찾는다.
  - 인증이 성공하면 런타임별 relay 구현이 스트리밍 연결을 수립한다.
  - 연결 완료 이벤트를 보낸다.

### `PLATFORM-RELAY-02` Slack 이벤트 전달

- Trigger: Slack event callback
- Main Flow:
  - 봇 ID 대상 relay에 이벤트를 dispatch 한다.
  - 연결이 없으면 드롭하되 경고를 남긴다.

### `PLATFORM-RELAY-03` Slack API 프록시

- Trigger: `POST /relay/api`
- Main Flow:
  - `x-connect-key`로 봇을 인증한다.
  - Vault로 봇 토큰을 복호화한다.
  - Slack API 호출을 대행하고 응답을 돌려준다.

## Constraints

- `PLATFORM-RELAY-C-001`: 봇 런타임은 Slack 토큰을 직접 보유하지 않아야 한다.
- `PLATFORM-RELAY-C-002`: 비활성 봇은 스트림 연결과 API 호출이 모두 거부돼야 한다.
- `PLATFORM-RELAY-C-003`: 런타임별 relay 구현 차이가 있어도 `RelayHub` 외부 계약은 동일해야 한다.

## Interface

- `RelayHub`
  - `handleStream(c, botId, connectKey)`
  - `dispatch(botId, event)`
  - `isConnected(botId)`
  - `connectedBots()`
- Routes:
  - `GET /relay/stream`
  - `POST /relay/api`

## Realization

- 모듈 경계:
  - `relay/api-proxy.ts`는 Slack API proxy만, 런타임별 `runtime/*/relay.ts`는 연결 유지와 dispatch만 담당한다.
- 상태 모델:
  - Node.js는 봇당 SSE 연결, CF는 봇당 Durable Object/WebSocket 연결을 사용한다.
- 실패 처리:
  - 연결 없음은 이벤트 드롭으로 처리하되 시스템 전체 실패로 보지 않는다.

## Dependencies

- Depends On: `vault.md`, `database.md`, `runtime.md`
- Blocks: `platform-connector`
- Parallelizable With: `slack-integration.md`

## AC

- Given 유효한 connect key가 있을 때 When 봇 런타임이 `/relay/stream`에 연결하면 Then relay 연결이 수립된다.
- Given Slack 이벤트가 들어올 때 When 대상 봇이 연결돼 있으면 Then 이벤트가 해당 봇에 전달된다.
- Given 봇 런타임이 `/relay/api`를 호출할 때 When 인증이 통과하면 Then 플랫폼이 Slack API를 대신 호출한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

