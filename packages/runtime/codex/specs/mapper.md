# Codex Notification Mapper

## 한 줄 요약

Codex App Server 알림을 `@sena-ai/core`의 `RuntimeEvent` 계약으로 축약해 런타임과 상위 계층 사이의 이벤트 표면을 고정한다.

## 상위 스펙 연결

- 관련 요구사항: `CODEX-FR-002`
- 관련 수용 기준: `CODEX-AC-002`

## Behavior

- Trigger:
  Codex가 `notification` 이벤트로 알림을 보낸다.
- Main Flow:
  1. `item/agentMessage/delta`는 `progress.delta`로 변환한다.
  2. `item/started`는 도구 유형에 따라 `tool.start`로 변환한다.
  3. `item/completed`는 도구 유형/성공 여부에 따라 `tool.end` 또는 `progress`로 변환한다.
  4. `turn/completed`는 상태에 따라 `result` 또는 `error`를 반환한다.
  5. `error` 알림은 `error` 이벤트로 변환한다.
- Failure Modes:
  알 수 없는 알림이나 변환 불가능한 payload는 `null`을 반환해 상위가 무시한다.

## Constraints

- `CODEX-MAP-CON-001`: 도구 이름은 `shell:`, `file:`, `mcp:`, `tool:` 접두사 규칙을 유지해야 한다.
- `CODEX-MAP-CON-002`: `turn/completed` 성공 시 마지막 agent message 텍스트를 결과로 사용해야 한다.
- `CODEX-MAP-CON-003`: 실패 상태는 `error` 이벤트로 수렴해야 한다.

## Interface

- 함수:
  `mapCodexNotification(method: string, params: unknown): RuntimeEvent | null`
- 입력:
  Codex notification method + params
- 출력:
  단일 `RuntimeEvent` 또는 `null`

## Realization

- mapper는 상태를 가지지 않는 순수 함수로 유지한다.
- 툴 타입 판별은 payload의 `item.type` 또는 fallback 필드를 사용한다.
- progress/result 텍스트는 agent message content 배열의 text 블록만 합쳐 생성한다.

## Dependencies

- Depends On:
  [@sena-ai/core types](/Users/channy/workspace/sena-ai/packages/core/specs/types.md)
- Blocks:
  [runtime.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/runtime.md)
- Parallelizable With:
  [app-server-client.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/app-server-client.md)

## AC

- Given `item/started`가 `commandExecution` payload로 들어올 때, When mapper가 처리하면, Then `tool.start`와 `shell:{command}` 이름을 반환한다.
- Given `item/completed`가 `mcpToolCall` 실패 payload로 들어올 때, When mapper가 처리하면, Then `tool.end`와 `isError: true`를 반환한다.
- Given `turn/completed`가 `completed` 상태일 때, When 마지막 agent message가 존재하면, Then 해당 text가 `result.text`가 된다.
- Given 지원하지 않는 알림일 때, When mapper가 실행되면, Then `null`을 반환한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
