# Orchestrator

## 한 줄 요약

Orchestrator는 Worker 자식 프로세스와 HTTP 프록시를 관리하며 rolling restart와 crash recovery를 제공한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-005`, `CORE-NFR-003`
- 관련 수용 기준: `CORE-AC-004`

## Behavior

- Trigger:
  CLI 또는 상위 호출자가 `start()`, `restart()`, `stop()`을 호출한다.
- Main Flow:
  1. Worker 스크립트를 fork하고 ready 메시지를 기다린다.
  2. Worker 포트가 있으면 프록시 서버를 시작하고 없으면 아웃바운드 전용 모드로 둔다.
  3. `restart()`는 새 Worker를 띄워 ready 이후 트래픽을 교체한다.
  4. 이전 Worker는 `drain` 후 release하고 안전 타임아웃을 둔다.
  5. 비정상 종료한 현재 Worker는 자동 재생성한다.
  6. `stop()`은 프록시 종료 후 Worker drain과 종료 대기를 수행한다.
- Failure Modes:
  새 Worker 준비 실패 시 기존 Worker를 유지한다.

## Constraints

- `CORE-ORCH-CON-001`: rolling restart 동안 이전 Worker는 새 Worker ready 전까지 트래픽을 계속 처리해야 한다.
- `CORE-ORCH-CON-002`: released Worker는 crash recovery 대상이 아니다.
- `CORE-ORCH-CON-003`: Worker 포트가 0이면 프록시 서버를 강제 기동하지 않는다.
- `CORE-ORCH-CON-004`: 명시적 workerPort가 있을 때는 세대 번호로 포트 충돌을 회피해야 한다.

## Interface

- API:
  `createOrchestrator(options: OrchestratorOptions)`
- 옵션:
  `port`, `workerScript`, `workerPort?`
- 반환:
  `start(): Promise<void>`, `restart(): Promise<void>`, `stop(): Promise<void>`

## Realization

- 자식 프로세스 관리는 Node `fork()`와 IPC 메시지로 수행한다.
- ready/drain/request-restart 메시지 계약으로 Worker와 통신한다.
- `.ts`/`.tsx` worker 진입점은 `tsx` import 모드로 실행 가능해야 한다.

## Dependencies

- Depends On:
  [worker.md](/Users/channy/workspace/sena-ai/packages/core/specs/worker.md)
- Blocks:
  CLI daemon/foreground 실행 경로
- Parallelizable With:
  Worker 내부 로직 변경

## AC

- Given Orchestrator가 시작될 때, When Worker가 ready 메시지를 보내면, Then 프록시는 해당 Worker 포트로 요청을 전달한다.
- Given rolling restart 요청, When 새 Worker가 준비되면, Then 기존 Worker는 drain되고 새 Worker가 currentWorker가 된다.
- Given stop 요청, When 타임아웃 내 종료가 안 되면, Then Worker는 강제 종료된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

