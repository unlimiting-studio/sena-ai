# Scheduler

## 한 줄 요약

Scheduler는 heartbeat와 cron 표현식을 표준 턴 실행 요청으로 변환하고 중복 실행을 막는다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-006`, `CORE-FR-002`
- 관련 수용 기준: `CORE-AC-003`

## Behavior

- Trigger:
  Worker가 Scheduler를 시작하거나 reload한다.
- Main Flow:
  1. heartbeat 스케줄은 즉시 한 번 실행하고 이후 interval마다 반복한다.
  2. cron 스케줄은 1분마다 현재 시각과 표현식을 비교한다.
  3. 각 스케줄 실행은 `trigger: 'schedule'` 턴으로 위임한다.
  4. 같은 스케줄이 실행 중이면 다음 틱을 건너뛴다.
  5. `reload()`는 모든 타이머를 정리한 뒤 새 스케줄 집합으로 재시작한다.
- Failure Modes:
  개별 스케줄 턴 실패는 로깅하고 다른 스케줄은 계속 실행한다.

## Constraints

- `CORE-SCHED-CON-001`: heartbeat는 시작 즉시 첫 실행을 해야 한다.
- `CORE-SCHED-CON-002`: cron 매칭은 1분 단위이며 timezone을 고려해야 한다.
- `CORE-SCHED-CON-003`: 동일 스케줄의 동시 실행은 금지된다.

## Interface

- API:
  `createScheduler(options: SchedulerOptions)`
  `cronSchedule(expression, options)`
  `heartbeat(interval, options)`
- 반환:
  `start()`, `stop()`, `reload(newSchedules)`

## Realization

- `running` 플래그와 타이머 핸들 집합으로 중복 실행과 정리를 관리한다.
- cron 파서는 `*`, `*/N`, `N-M`, `N,M`, `N` 형식을 지원한다.

## Dependencies

- Depends On:
  [turn-engine.md](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md), [types.md](/Users/channy/workspace/sena-ai/packages/core/specs/types.md)
- Blocks:
  Worker의 schedule 실행 경로
- Parallelizable With:
  커넥터 실행 경로

## AC

- Given heartbeat 스케줄, When `start()`를 호출하면, Then 즉시 한 번 실행되고 지정 간격으로 반복된다.
- Given cron 스케줄이 실행 중일 때, When 다음 틱이 도착하면, Then 중복 실행 없이 건너뛴다.
- Given `reload()` 호출, When 새 스케줄 집합이 주어지면, Then 기존 타이머는 정리되고 새 스케줄만 활성화된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

