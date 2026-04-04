# Types

## 한 줄 요약

`@sena-ai/core`의 공유 타입은 런타임, 커넥터, 훅, 도구, 스케줄 구현이 같은 계약을 바라보게 하는 단일 표면이다.

## 상위 스펙 연결

- 관련 요구사항: `CORE-FR-008`, `CORE-FR-002`, `CORE-FR-004`, `CORE-FR-007`
- 관련 수용 기준: `CORE-AC-002`, `CORE-AC-003`

## Behavior

- Trigger:
  하위 패키지가 core 타입을 import해 구현 계약을 맞춘다.
- Main Flow:
  1. 컨텍스트/훅 타입이 턴 전후 확장 지점을 정의한다.
  2. 런타임 타입이 스트림 이벤트와 세션/도구 입력 계약을 정의한다.
  3. 커넥터 타입이 inbound/outbound 표면을 정의한다.
  4. 도구/스케줄/세션/설정 타입이 core 외부 계약을 고정한다.

## Constraints

- `CORE-TYPES-CON-001`: `RuntimeEvent`는 `session.init`, `progress`, `progress.delta`, `tool.start`, `tool.end`, `result`, `error`를 포함해야 한다.
- `CORE-TYPES-CON-002`: `TurnTrace`는 assembled context, result, error, hooks, followUps를 표현할 수 있어야 한다.
- `CORE-TYPES-CON-003`: `ToolPort`는 MCP와 inline 포트를 모두 표현해야 한다.

## Interface

- Context/Hook:
  `ContextFragment`, `TurnStartHook`, `TurnEndHook`, `ErrorHook`
- Turn:
  `FileAttachment`, `TurnContext`, `TurnResult`, `TurnTrace`, `HookTrace`
- Runtime:
  `UserMessage`, `RuntimeEvent`, `PendingMessageSource`, `RuntimeStreamOptions`, `Runtime`
- Connector:
  `InboundEvent`, `ConnectorOutput`, `Connector`, `HttpServer`
- Tool:
  `ToolPort`, `McpToolPort`, `InlineToolPort`, `InlineToolDef`
- Schedule/Session/Config:
  `Schedule`, `SessionStore`, `SenaConfig`, `OrchestratorConfig`

## Realization

- 타입 정의는 `types.ts` 한 곳에 모으고 하위 패키지에서 재수출한다.
- 상세 필드 계약은 런타임/커넥터/도구가 독립 구현 가능할 정도로만 구체화한다.

## Dependencies

- Depends On:
  없음
- Blocks:
  runtime, connector, hooks, tools, cli 전체
- Parallelizable With:
  개별 구현 문서 전반

## AC

- Given 런타임 구현체가 core 계약을 구현할 때, When `RuntimeEvent`를 발행하면, Then Worker/Turn Engine이 동일 타입으로 소비할 수 있다.
- Given 커넥터가 inbound 이벤트를 생성할 때, When `InboundEvent`를 전달하면, Then Worker는 conversation/session/tool 비활성화 정보를 해석할 수 있다.
- Given 인라인 도구와 MCP 도구가 혼재할 때, When core가 이를 받으면, Then `ToolPort` 유니온으로 동일하게 전달할 수 있다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

