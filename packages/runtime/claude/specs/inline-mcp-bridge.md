# Claude Inline MCP Bridge

## 한 줄 요약

인라인 도구를 Claude SDK가 호출할 수 있도록 로컬 HTTP MCP 서버로 노출하는 브릿지다.

## 상위 스펙 연결

- Related Requirements: `CLAUDE-FR-003`
- Related AC: `CLAUDE-AC-003`

## Behavior

### `CLAUDE-BRIDGE-01` 브릿지 시작

- Trigger: 인라인 도구가 하나 이상 포함된 런타임 실행
- Main Flow:
  - `127.0.0.1`의 랜덤 포트에 HTTP 서버를 연다.
  - `/mcp` 경로에서 Streamable HTTP MCP 요청을 처리한다.
  - initialize 요청 이후 세션별 transport를 유지한다.

### `CLAUDE-BRIDGE-02` 도구 호출 정규화

- Trigger: MCP tool call
- Main Flow:
  - 인라인 도구 핸들러 결과를 MCP content 배열로 바꾼다.
  - string/object/브랜디드 결과/예외를 모두 일관된 응답 형식으로 변환한다.

### `CLAUDE-BRIDGE-03` dirty signal 리셋

- Trigger: transport `onclose` 또는 Slack 네이티브 도구 관련 stream closed 에러
- Main Flow:
  - dirty 상태를 표시하고 필요 시 `reset()`으로 transport를 정리한다.

## Constraints

- `CLAUDE-BRIDGE-C-001`: 인라인 도구가 없으면 브릿지를 생성하지 않아야 한다.
- `CLAUDE-BRIDGE-C-002`: close/reset 시 열린 transport와 HTTP 서버를 모두 정리해야 한다.
- `CLAUDE-BRIDGE-C-003`: 예외를 그대로 throw 하지 말고 MCP 에러 응답으로 감싸야 한다.

## Interface

- `startInlineMcpHttpBridge(tools: InlineToolPort[]): Promise<InlineMcpBridge | null>`
- `InlineMcpBridge`
  - `url`
  - `reset(): Promise<void>`
  - `close(): Promise<void>`

## Realization

- 모듈 경계:
  - `inline-mcp-bridge.ts`가 HTTP 서버, session transport, MCP server 생성을 담당한다.
- 상태 모델:
  - session id별 transport Map과 dirty 플래그를 유지한다.

## Dependencies

- Depends On: MCP SDK, `@sena-ai/core`
- Blocks: [`runtime.md`](/Users/channy/workspace/sena-ai/packages/runtime/claude/specs/runtime.md)
- Parallelizable With: [`mapper.md`](/Users/channy/workspace/sena-ai/packages/runtime/claude/specs/mapper.md)

## AC

- Given 인라인 도구가 있을 때 When 브릿지를 시작하면 Then 랜덤 로컬 포트의 MCP URL이 생성된다.
- Given 인라인 도구 핸들러가 string/object/브랜디드 결과를 반환할 때 When MCP 호출이 들어오면 Then MCP content 응답으로 정규화된다.
- Given 브릿지 종료가 필요할 때 When `close()`를 호출하면 Then transport와 서버가 모두 정리된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
