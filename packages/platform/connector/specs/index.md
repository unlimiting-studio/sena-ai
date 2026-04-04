# @sena-ai/platform-connector

## 한 줄 요약

로컬 봇 런타임이 sena-ai 플랫폼과 연결돼 Slack 이벤트를 받고 Slack 응답을 플랫폼 API 프록시를 통해 보내도록 하는 커넥터다.

## 문제 정의

- 플랫폼 기반 배포에서는 로컬 런타임이 Slack 토큰 없이 플랫폼을 통해서만 Slack과 통신해야 한다.
- 플랫폼 릴레이 전송 방식이 SSE 또는 WebSocket으로 달라질 수 있으므로 커넥터가 전송 계층 차이를 흡수해야 한다.

## 목표 & 성공 지표

- `platformConnector()` 하나로 코어 `Connector` 계약을 만족한다.
- 로컬 런타임은 `connect_key`와 platform URL만으로 이벤트 수신/응답 전송이 가능하다.

## 스펙 안정성 분류

- `Stable`: Zero Token Exposure, `connect_key` 인증, `Connector` 외부 계약
- `Flexible`: transport auto fallback 정책 세부
- `Experimental`: 추가 플랫폼 이벤트 타입

## 용어 정의

- `platform connector`: 플랫폼 릴레이를 소비하는 로컬 런타임용 커넥터.
- `transport`: SSE/WebSocket/auto 전송 계층.

## 요구사항

- `PCONN-FR-001 [Committed][Stable]`: 플랫폼 connector는 코어 `Connector` 인터페이스를 구현해야 한다.
- `PCONN-FR-002 [Committed][Stable]`: 플랫폼 릴레이 스트림에서 Slack 이벤트를 받아 `InboundEvent`로 변환해야 한다.
- `PCONN-FR-003 [Committed][Stable]`: Slack 응답은 `/relay/api` 프록시를 통해 전송해야 한다.
- `PCONN-FR-004 [Committed][Stable]`: SSE, WebSocket, auto transport를 지원해야 한다.
- `PCONN-NFR-001 [Committed][Stable]`: 로컬 런타임은 Slack 토큰을 직접 소유하지 않아야 한다.

## 수용 기준 (AC)

- `PCONN-AC-001`: Given 유효한 platform URL과 connect key가 있을 때 When connector를 시작하면 Then 릴레이 스트림 연결이 수립된다.
- `PCONN-AC-002`: Given slack_event가 도착할 때 When connector가 이를 처리하면 Then `InboundEvent`로 turn engine에 전달된다.
- `PCONN-AC-003`: Given 출력이 필요할 때 When connector output이 실행되면 Then Slack API 호출은 `/relay/api`를 통해 이뤄진다.
- `PCONN-AC-004`: Given auto transport가 WebSocket 연결에서 426 Upgrade Required를 받으면 When connector가 연결을 재시도하면 Then SSE transport로 폴백한다.

## 의존관계 맵

- Depends On: `@sena-ai/core`, platform relay/api routes
- Blocks: 플랫폼 기반 로컬 봇 런타임
- Parallelizable With: `platform-core`

## 범위 경계 (Non-goals)

- Slack Events API 직접 수신은 하지 않는다.
- 플랫폼 없는 독립 Slack 실행 모드는 포함하지 않는다.

## 제약 & 가정

- 플랫폼 서버가 `/relay/stream`, `/relay/api`를 제공한다고 가정한다.

## 리스크 & 완화책

- `Risk`: transport별 오류 처리 차이로 연결 실패 경험이 갈라질 수 있다.
  - `완화`: 공통 transport 인터페이스와 auto fallback 규칙을 고정한다.

## 검증 계획

- 수동 smoke test로 SSE/WebSocket/auto 연결, inbound mapping, output proxy 호출 검증

## 상세 스펙 맵

- [connector.md](/Users/channy/workspace/sena-ai/packages/platform/connector/specs/connector.md)
- [transport.md](/Users/channy/workspace/sena-ai/packages/platform/connector/specs/transport.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
