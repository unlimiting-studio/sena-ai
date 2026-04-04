# Worker

## 한 줄 요약

Worker는 커넥터 서빙, 세션 저장, steer 큐잉, 스케줄 실행, graceful drain을 포함하는 실제 에이전트 실행 프로세스다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-004`, `CORE-FR-002`, `CORE-FR-006`, `CORE-NFR-002`, `CORE-NFR-003`
- 관련 수용 기준: `CORE-AC-003`

## Behavior

- Actor:
  Orchestrator 또는 독립 실행 진입점이 Worker를 시작한다.
- Main Flow:
  1. 세션 스토어를 초기화한다.
  2. 내장 `restart_agent` 도구를 등록하고 Turn Engine을 만든다.
  3. 스케줄이 있으면 Scheduler를 연결한다.
  4. 커넥터 라우트를 서버에 등록하고 `/health`를 제공한다.
  5. `submitTurn()`은 대화별 활성 턴이 없으면 즉시 실행하고, 있으면 pending queue에 넣는다.
  6. 활성 턴은 `pendingMessages`와 follow-up을 steer 또는 후속 턴으로 이어 처리한다.
  7. drain 시 새 턴을 거부하고 서버/커넥터/스케줄러를 멈춘 뒤 활성 턴 종료를 기다린다.
- Failure Modes:
  턴 오류는 해당 커넥터 output으로 전달하되 abort로 인한 종료는 사용자 에러로 전송하지 않는다.

## Constraints

- `CORE-WORKER-CON-001`: 같은 대화의 동시 입력은 큐잉되어 순서가 보존되어야 한다.
- `CORE-WORKER-CON-002`: drain 중에는 새 턴을 받으면 안 된다.
- `CORE-WORKER-CON-003`: 활성 턴이 끝나기 전 프로세스를 정상 종료하면 안 된다.
- `CORE-WORKER-CON-004`: `sessionStore` 미지정 시 파일 기반 저장소를 기본으로 사용해야 한다.

## Interface

- API:
  `createWorker(options: WorkerOptions)`
  `createFileSessionStore(filePath: string): SessionStore`
  `requestWorkerRestart(): boolean`
- 반환:
  `start()`, `stop()`, `engine`, `requestRestart()`

## Realization

- conversation별 활성 실행과 pending queue를 맵으로 관리한다.
- output은 커넥터별 `createOutput()`으로 생성하고 턴 단위로 dispose한다. `createOutput()`에 전달하는 `ConnectorOutputContext`에는 해당 턴의 `InboundEvent.raw`를 `metadata` 필드로 포함한다.
- `PendingMessageSource.restore()`는 복원 시 다음 두 가지를 보장해야 한다:
  - **원본 `raw` 보존**: 개별 pending event의 `raw`를 유지해야 한다. 현재 구현의 `{ ...event, text }` spread는 현재 turn의 `raw`를 모든 복원 이벤트에 복사하므로, connector-specific per-turn 메타데이터(e.g. trigger-level thinkingMessage)가 오염된다. restore는 drain 전 원본 `InboundEvent`를 보존하고 text만 갱신하는 방식으로 수정한다.
  - **FIFO 순서 보존**: `drain()`이 오래된 순서(FIFO)로 메시지를 넘기므로, `restore()`도 같은 순서를 유지해야 한다. 현재 `unshift` 루프는 복원 이벤트를 역순으로 삽입하므로 steer 실패 시 후속 턴의 메시지 순서가 뒤집힌다. 복원은 원본 큐 순서를 그대로 앞에 삽입(e.g. `unshift(...events)` 또는 `splice`)해야 한다.
- drain은 IPC `drain` 메시지 또는 부모 disconnect로 진입한다.

## Dependencies

- Depends On:
  [turn-engine.md](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md), [scheduler.md](/Users/channy/workspace/sena-ai/packages/core/specs/scheduler.md), Connector 구현체
- Blocks:
  [orchestrator.md](/Users/channy/workspace/sena-ai/packages/core/specs/orchestrator.md), CLI/worker-entry
- Parallelizable With:
  세션 저장소 대체 구현

## AC

- Given 같은 conversationId로 새 메시지가 도착할 때, When 활성 턴이 존재하면, Then 새 메시지는 pending queue로 들어가 steer 또는 후속 턴 처리에 사용된다.
- Given drain이 시작될 때, When 새 턴이 도착하면, Then Worker는 이를 거부하고 기존 활성 턴만 마무리한다.
- Given 턴이 성공 종료될 때, When 세션 ID가 생기면, Then 세션 스토어에 conversationId -> sessionId가 저장된다.
- Given 서로 다른 `raw`를 가진 pending event가 steer drain 후 restore될 때, When 후속 turn으로 처리되면, Then 각 event는 자신의 원본 `raw`를 유지하고, 현재 turn의 `raw`로 대체되지 않는다.
- Given pending event A(먼저 도착), B(나중 도착)가 drain 후 restore될 때, When 후속 turn으로 순차 처리되면, Then A가 B보다 먼저 처리되어 FIFO 순서가 보존된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

