# Codex Inline MCP Server

## 한 줄 요약

코어 인라인 도구를 Codex가 연결할 수 있도록 로컬 HTTP MCP 서버로 노출한다.

## 상위 스펙 연결

- Related Requirements: `CODEX-FR-004`, `CODEX-NFR-001`
- Related AC: `CODEX-AC-003`

## Behavior

### `CODEX-BRIDGE-01` 서버 시작

- Trigger: 인라인 도구 배열이 비어 있지 않을 때
- Main Flow:
  - `127.0.0.1` 랜덤 포트에 HTTP 서버를 연다.
  - `/mcp` 경로에서 세션 기반 MCP 요청을 처리한다.

### `CODEX-BRIDGE-02` 도구 결과 정규화

- Trigger: MCP tool call
- Main Flow:
  - 브랜디드 결과는 text content만 추출해 반환한다.
  - string은 그대로, object는 JSON 문자열로 반환한다.

### `CODEX-BRIDGE-03` 종료

- Trigger: `close()`
- Main Flow:
  - 모든 transport를 닫고 HTTP 서버를 종료한다.

## Constraints

- `CODEX-BRIDGE-C-001`: 인라인 도구가 없으면 `null`을 반환해야 한다.
- `CODEX-BRIDGE-C-002`: 종료 후 포트 리소스가 해제되어야 한다.
- `CODEX-BRIDGE-C-003`: 파라미터 스키마가 없으면 느슨한 object 스키마로 fallback 해야 한다.

## Interface

- `startInlineMcpHttpServer(tools: InlineToolPort[]): Promise<InlineMcpBridge | null>`
- `InlineMcpBridge`
  - `url`
  - `close(): Promise<void>`

## Realization

- 모듈 경계:
  - `inline-mcp-server.ts`가 HTTP 서버, session transport, result normalization을 담당한다.
- 상태 모델:
  - `mcp-session-id` 헤더 기준으로 세션 transport를 유지한다.

## Dependencies

- Depends On: MCP SDK, `@sena-ai/core`, `zod`
- Blocks: [`runtime.md`](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/runtime.md)
- Parallelizable With: [`app-server-client.md`](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/app-server-client.md)

## AC

- Given 인라인 도구 배열이 비어 있을 때 When 서버를 시작하면 Then `null`을 반환한다.
- Given 인라인 도구 호출이 들어올 때 When handler가 값을 반환하면 Then MCP text content 응답이 생성된다.
- Given 서버를 닫을 때 When `close()`를 호출하면 Then HTTP 서버가 clean shutdown 된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
