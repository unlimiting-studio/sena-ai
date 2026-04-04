# Agent

## 한 줄 요약

`createAgent()`는 정규화된 설정으로 Turn Engine을 감싸 프로그래밍 방식의 단일 턴 실행 API를 제공한다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-003`, `CORE-FR-002`
- 관련 수용 기준: `CORE-AC-002`

## Behavior

- Trigger:
  사용자가 `ResolvedSenaConfig`로 `createAgent()`를 호출한다.
- Main Flow:
  1. 설정의 `name`, `cwd`, `runtime`, `hooks`, `tools`로 Turn Engine을 만든다.
  2. `name` 속성을 노출한다.
  3. `processTurn()` 호출을 Turn Engine의 `processTurn()`에 그대로 위임한다.
- Failure Modes:
  설정 또는 턴 실행 실패는 하위 Turn Engine 오류를 그대로 노출한다.

## Constraints

- `CORE-AGENT-CON-001`: Agent는 자체 실행 상태를 가지지 않고 Turn Engine 위임자여야 한다.
- `CORE-AGENT-CON-002`: 공개 API는 `name`과 `processTurn()`으로 제한된다.

## Interface

- API:
  `createAgent(config: ResolvedSenaConfig): Agent`
- 계약:
  `Agent.name`, `Agent.processTurn(options): Promise<TurnTrace>`

## Realization

- `agent.ts`는 Turn Engine 생성과 위임만 담당하는 얇은 래퍼로 유지한다.

## Dependencies

- Depends On:
  [turn-engine.md](/Users/channy/workspace/sena-ai/packages/core/specs/turn-engine.md), [defineConfig.md](/Users/channy/workspace/sena-ai/packages/core/specs/defineConfig.md)
- Blocks:
  프로그래밍 방식 core 소비 경로
- Parallelizable With:
  Worker/Orchestrator 문서 정비

## AC

- Given `ResolvedSenaConfig`, When `createAgent()`를 호출하면, Then 내부 Turn Engine이 설정으로 생성된다.
- Given `agent.processTurn()` 호출, When 실행이 끝나면, Then Turn Engine의 `TurnTrace`가 그대로 반환된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

