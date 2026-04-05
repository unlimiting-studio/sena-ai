# traceLogger

## 한 줄 요약

`traceLogger()`는 성공한 턴 결과를 JSON 파일로 기록하는 `onTurnEnd` 콜백이다.

## 상위 스펙 연결

- 관련 요구사항: `HOOKS-FR-002`, `HOOKS-NFR-001`, `HOOKS-NFR-002`
- 관련 수용 기준: `HOOKS-AC-003`

## Behavior

- Trigger:
  Turn Engine이 성공 종료 후 `onTurnEnd` 훅으로 `traceLogger`를 실행한다.
- Main Flow:
  1. 출력 디렉터리를 재귀적으로 준비한다.
  2. `{turnId}-{Date.now()}.json` 형식 파일명을 만든다.
  3. 턴 핵심 필드와 `TurnResult`를 JSON으로 기록한다.
  4. follow-up을 트리거하지 않고 `void`로 종료한다.

## Constraints

- `HOOKS-TRACE-CON-001`: 파일 출력은 UTF-8, 2-space JSON 포맷이어야 한다.
- `HOOKS-TRACE-CON-002`: 훅 `name`은 항상 `traceLogger`여야 한다.
- `HOOKS-TRACE-CON-003`: 출력은 성공한 턴에 대해서만 수행한다.

## Interface

- API:
  `traceLogger(options: TraceLoggerOptions): TurnEndCallback`
- 옵션:
  `dir`, `format?: 'json'`

## Realization

- Node 파일 시스템에 직접 기록하는 최소 구현으로 유지한다.
- 기록 내용은 디버깅과 감사에 필요한 턴 요약 필드를 중심으로 둔다.

## Dependencies

- Depends On:
  [@sena-ai/core types](/Users/channy/workspace/sena-ai/packages/core/specs/types.md), [Turn Engine](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md)
- Blocks:
  trace 파일 기반 디버깅 경로
- Parallelizable With:
  fileContext

## AC

- Given output dir가 없을 때, When 훅이 실행되면, Then 디렉터리를 만들고 trace 파일을 기록한다.
- Given 턴이 성공 종료될 때, When trace 파일을 열어보면, Then `turnId`, `agentName`, `trigger`, `input`, `timestamp`, `result`가 포함된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

