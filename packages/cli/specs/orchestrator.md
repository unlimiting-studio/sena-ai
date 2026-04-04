# CLI Orchestrator / Worker Architecture

## 한 줄 요약

CLI는 core의 Orchestrator/Worker를 프로세스 모델로 감싸 foreground, daemon, rolling restart 운영 경로를 제공한다.

## 상위 스펙 연결

- 관련 요구사항: `CLI-FR-003`, `CLI-NFR-001`
- 관련 수용 기준: `CLI-AC-002`, `CLI-AC-003`

## Behavior

- Trigger:
  `sena start`, `restart`, `stop`이 core Orchestrator/Worker 경로를 사용한다.
- Main Flow:
  1. foreground start는 `createOrchestrator()`로 Orchestrator를 띄운다.
  2. Orchestrator는 Worker를 fork하고 ready 후 프록시를 붙인다.
  3. daemon start는 같은 CLI 바이너리를 detach된 foreground 경로로 재실행한다.
  4. `SIGUSR2`는 rolling restart를 트리거한다.
  5. `SIGINT`/`SIGTERM`은 graceful stop으로 이어진다.
  6. Worker 진입점은 설정 파일과 포트를 읽어 core Worker를 만든다.

## Constraints

- `CLI-ARCH-CON-001`: foreground와 daemon 모두 궁극적으로 같은 Orchestrator/Worker 경로를 사용해야 한다.
- `CLI-ARCH-CON-002`: worker 부트 중 부모 disconnect는 고아 프로세스 방지를 위해 즉시 실패 처리해야 한다.
- `CLI-ARCH-CON-003`: rolling restart는 ready 기반 전환을 유지해야 한다.

## Interface

- 환경변수:
  `SENA_CONFIG_PATH`, `SENA_WORKER_PORT`, `SENA_GENERATION`, `SENA_PORT`
- IPC:
  `ready`, `request-restart`, `drain`
- 파일:
  `.sena.pid`, `sena.log`, `.sessions.json`

## Realization

- 프로세스 경계와 시그널 해석은 CLI가 맡고, 실제 실행 로직은 core Orchestrator/Worker에 위임한다.
- worker-entry는 core Worker 생성 전 early disconnect guard를 둔다.

## Dependencies

- Depends On:
  [@sena-ai/core Orchestrator](/Users/channy/workspace/sena-ai/packages/core/specs/orchestrator.md), [@sena-ai/core Worker](/Users/channy/workspace/sena-ai/packages/core/specs/worker.md)
- Blocks:
  CLI start/restart/stop 흐름
- Parallelizable With:
  명령어 UX 정리

## AC

- Given foreground start, When Worker가 ready를 보내면, Then 공개 포트는 Orchestrator 프록시가 맡는다.
- Given `SIGUSR2`, When Orchestrator가 이를 수신하면, Then rolling restart 경로가 실행된다.
- Given 부트 중 부모 disconnect, When worker-entry가 이를 감지하면, Then Worker는 고아 프로세스가 되지 않고 종료된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

