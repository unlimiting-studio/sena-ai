# @sena-ai/platform-worker

## 한 줄 요약

Cloudflare Workers 환경에서 platform-core, D1 repository, CF runtime, Durable Object relay를 조합해 플랫폼을 실행한다.

## 문제 정의

- Workers 배포는 요청 단위 초기화, scheduled trigger, Durable Object relay라는 Node와 다른 제약을 가진다.
- config token bootstrap, scheduled rotation, relay durable object 책임이 문서화되지 않으면 환경별 동작 차이가 커진다.

## 목표 & 성공 지표

- fetch handler가 매 요청마다 runtime/repos/app을 조합해 일관된 응답을 제공한다.
- 환경변수 기반 config token bootstrap과 10시간 scheduled rotation이 유지된다.
- RelayDurableObject의 WebSocket/dispatch 책임이 별도 상세 스펙으로 분리된다.
- 완료 기준:
  - worker 엔트리포인트와 durable object가 각각 별도 책임 문서로 분리된다.
  - platform-core와 runtime-worker 결합 면이 추적 가능하다.

## 스펙 안정성 분류

- Stable
  - fetch/scheduled 진입점 의미
  - bootstrap 조건과 rotation 주기
  - RelayDurableObject의 ws/dispatch 계약
- Flexible
  - 로그 문구, 내부 Set 관리 방식
- Experimental
  - Durable Object 기반 connected state의 관측 정밀도

## 용어 정의

- Bootstrap Config Token: env에 있는 초기 config token을 DB에 한번 심는 흐름.
- Scheduled Rotation: scheduled handler가 10시간마다 token을 갱신하는 작업.
- RelayDurableObject: 봇별 WebSocket 연결과 event dispatch를 관리하는 Durable Object.

## 요구사항

- PLATFORM-WORKER-FR-001 [Committed][Stable]: fetch handler는 매 요청마다 CF runtime, D1 repos, createApp를 조합해 app.fetch를 호출해야 한다.
- PLATFORM-WORKER-FR-002 [Committed][Stable]: bootstrap config token은 env 값이 있고 DB에 기존 row가 없을 때만 upsert 해야 한다.
- PLATFORM-WORKER-FR-003 [Committed][Stable]: scheduled handler는 모든 config token을 순회하며 rotateConfigToken을 수행해야 한다.
- PLATFORM-WORKER-FR-004 [Committed][Stable]: RelayDurableObject는 /ws upgrade와 /dispatch POST를 처리해야 한다.
- PLATFORM-WORKER-NFR-001 [Committed][Stable]: Durable Object 연결 종료는 내부 Set에서 정리되어야 한다.
- PLATFORM-WORKER-NFR-002 [Committed][Flexible]: connected state는 hibernation 복원 이후 best-effort로 유지될 수 있다.

## 수용 기준 (AC)

- PLATFORM-WORKER-AC-001: Given fetch 요청이 들어오면 When worker가 처리하면 Then runtime/repos/app이 조합되고 app.fetch 결과가 반환된다. 관련: PLATFORM-WORKER-FR-001
- PLATFORM-WORKER-AC-002: Given env에 초기 token이 있고 DB에 row가 없으면 When fetch가 처음 실행되면 Then config token row가 시드된다. 관련: PLATFORM-WORKER-FR-002
- PLATFORM-WORKER-AC-003: Given scheduled trigger가 발화하면 When handler가 실행되면 Then 모든 workspace token에 대해 rotateConfigToken이 순회 호출된다. 관련: PLATFORM-WORKER-FR-003
- PLATFORM-WORKER-AC-004: Given relay client가 /ws에 연결하면 When Durable Object가 처리하면 Then connected 메시지를 보내고 연결을 보관한다. 관련: PLATFORM-WORKER-FR-004
- PLATFORM-WORKER-AC-005: Given /dispatch에 event가 들어오면 When Durable Object가 처리하면 Then 연결된 모든 WebSocket으로 slack_event를 브로드캐스트한다. 관련: PLATFORM-WORKER-FR-004, PLATFORM-WORKER-NFR-001

## 의존관계 맵

- Depends On: @sena-ai/platform-core, @sena-ai/platform-core/cf, @sena-ai/platform-core/db/d1, Durable Objects, D1
- Blocks: Workers 기반 플랫폼 배포
- Parallelizable With: platform-node 배포 경로

## 범위 경계 (Non-goals)

- 자체 애플리케이션 라우트 추가
- WebSocket 메시지의 양방향 custom protocol 확장
- D1 migration 설계 자체 변경

## 제약 & 가정

- CF env에 PLATFORM_BASE_URL, SLACK_WORKSPACE_ID, DB, VAULT key가 주입된다고 가정한다.
- bootstrap token은 env 기반 초기값일 뿐 지속적인 source of truth는 DB다.
- Durable Object는 봇별 인스턴스로 매핑된다고 가정한다.

## 리스크 & 완화책

- cold start 리스크: 매 요청 runtime/app 조립 비용이 있다.
  - 완화: 조립 순서를 명시하고 상태 보존 책임은 Durable Object로 한정한다.
- bootstrap 중복 리스크: fetch가 동시에 들어오면 같은 token을 여러 번 시드하려 할 수 있다.
  - 완화: existing 조회 후 upsert 규칙을 유지한다.
- relay 누수 리스크: 닫힌 WebSocket이 Set에 남을 수 있다.
  - 완화: close/error/dispatch 실패 시 정리 규칙을 명시한다.

## 검증 계획

- source review로 fetch/scheduled/bootstrap/DO 흐름을 검증한다.
- 수동 검증 시 첫 요청 bootstrap, scheduled rotation 로그, /ws 연결, /dispatch 브로드캐스트를 분리 확인한다.

## 상세 스펙

- [worker-runtime.md](/Users/channy/workspace/sena-ai/packages/platform/runtime-worker/specs/worker-runtime.md)
- [relay-durable-object.md](/Users/channy/workspace/sena-ai/packages/platform/runtime-worker/specs/relay-durable-object.md)

## 개편 메모

- Workers 배포 특유의 요청 단위 조립과 Durable Object relay를 분리해 책임 경계를 명확히 했다.
