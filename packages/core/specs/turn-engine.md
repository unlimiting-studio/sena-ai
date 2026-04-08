# Turn Engine

## 한 줄 요약

Turn Engine은 훅 실행, 컨텍스트 조립, 런타임 스트림 소비, 결과/에러/follow-up 기록을 하나의 턴 단위로 조율한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-002`, `CORE-FR-007`, `CORE-FR-008`, `CORE-NFR-002`
- 관련 수용 기준: `CORE-AC-002`

## Behavior

- Actor:
  Agent, Worker, Scheduler가 `processTurn()`을 호출한다.
- Main Flow:
  1. UUID 턴 ID와 `TurnContext`를 만든다.
  2. 커넥터 메타데이터가 있으면 현재 메시지/첨부 파일 컨텍스트를 자동 주입한다.
  3. `onTurnStart` 훅을 순서대로 실행해 `ContextFragment[]`를 수집한다.
  4. `system -> prepend -> append` 순서로 컨텍스트를 조립한다.
  5. `disabledTools`를 엔진 수준 exact match와 런타임 패턴 전달로 분리한다.
  6. 런타임 스트림을 소비해 progress/tool/result/error를 누적한다.
  7. 성공 시 `onTurnEnd`, 실패 시 `onError` 훅을 실행한다.
     - 단, Worker가 `metadata.isFollowUp === true`로 표시한 hook-originated follow-up turn에서는 `onTurnEnd`를 다시 실행하지 않는다.
  8. `onTurnEnd` 훅은 `TurnEndResult`를 반환할 수 있다: `void | { followUp?: string, fork?: boolean, detached?: boolean }`.
     - `followUp`만 있으면 blocking follow-up으로 기록된다 (`fork: false, detached: false`).
     - `fork: true`이면 fork follow-up으로 기록된다 (Worker가 별도 세션에서 실행).
     - `detached: true`는 fork 턴의 커넥터 출력을 억제한다 (`fork: true`일 때만 유효).
     - 반환값이 `void`이거나 `followUp`이 없으면 follow-up이 생성되지 않는다.
  9. 수집된 follow-up은 `TurnFollowUp[]` 타입으로 `TurnTrace.followUps`에 기록된다.
- Failure Modes:
  런타임 오류는 `onError` 훅 이후 `TurnTrace.error`로 기록된다.

## Constraints

- `CORE-ENGINE-CON-001`: 훅 실행 순서는 등록 순서를 유지해야 한다.
- `CORE-ENGINE-CON-002`: `onError` 훅 하나가 실패해도 나머지 훅 실행은 계속되어야 한다.
- `CORE-ENGINE-CON-003`: `result` 이벤트가 없으면 누적 progress 텍스트를 fallback 결과로 사용해야 한다.
- `CORE-ENGINE-CON-004`: exact match `disabledTools`는 런타임에 전달되기 전에 제거해야 한다.

## Interface

- API:
  `createTurnEngine(config: TurnEngineConfig): { processTurn }`
- 입력:
  `ProcessTurnOptions`의 `input`, `trigger`, `sessionId`, `connector`, `schedule`, `metadata`, `abortSignal`, `onEvent`, `pendingMessages`, `disabledTools`
- 출력:
  `Promise<TurnTrace>`

## Realization

- 컨텍스트 조립과 스트림 이벤트 누적은 엔진 내부에서만 수행한다.
- 커넥터 자동 주입은 conversation/thread/user/files 정보를 append fragment로 생성한다.
- 런타임 스트림은 `onEvent` 콜백에도 그대로 fan-out 된다.

## Dependencies

- Depends On:
  [types.md](/Users/channy/workspace/sena-ai/packages/core/specs/types.md), Runtime 구현체, Hook 구현체
- Blocks:
  [agent.md](/Users/channy/workspace/sena-ai/packages/core/specs/agent.md), [worker.md](/Users/channy/workspace/sena-ai/packages/core/specs/worker.md), [scheduler.md](/Users/channy/workspace/sena-ai/packages/core/specs/scheduler.md)
- Parallelizable With:
  [tool.md](/Users/channy/workspace/sena-ai/packages/core/specs/tool.md)

## AC

- Given connector 트리거와 첨부 파일, When Turn Engine이 컨텍스트를 조립하면, Then 현재 메시지/첨부 파일 안내가 append fragment에 포함된다.
- Given 런타임이 progress.delta와 tool 이벤트를 보낼 때, When Turn Engine이 처리하면, Then `TurnTrace.result.toolCalls`와 누적 텍스트가 일관되게 기록된다.
- Given `onTurnEnd` 훅이 `{ followUp: "..." }`를 반환할 때, When 턴이 성공 종료되면, Then `TurnFollowUp { prompt, fork: false, detached: false }`가 follow-up 목록에 추가된다.
- Given `onTurnEnd` 훅이 `{ followUp: "...", fork: true }`를 반환할 때, When 턴이 성공 종료되면, Then `TurnFollowUp { prompt, fork: true, detached: false }`가 follow-up 목록에 추가된다.
- Given `onTurnEnd` 훅이 `{ followUp: "...", fork: true, detached: true }`를 반환할 때, When 턴이 성공 종료되면, Then `TurnFollowUp { prompt, fork: true, detached: true }`가 follow-up 목록에 추가된다.
- Given `onTurnEnd` 훅이 `void`를 반환할 때, When 턴이 성공 종료되면, Then follow-up이 추가되지 않는다.
- Given Worker가 실행한 hook-originated follow-up turn에서 `metadata.isFollowUp === true`일 때, When 턴이 성공 종료되면, Then `onTurnEnd`는 다시 실행되지 않고 추가 follow-up도 생성되지 않는다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
