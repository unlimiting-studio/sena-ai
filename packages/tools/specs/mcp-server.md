# mcpServer

## 한 줄 요약

HTTP 또는 stdio MCP 서버 입력을 `McpToolPort`로 변환하는 단일 팩토리다.

## 상위 스펙 연결

- Related Requirements: `TOOLS-FR-001`, `TOOLS-FR-002`, `TOOLS-FR-003`, `TOOLS-NFR-001`
- Related AC: `TOOLS-AC-001`, `TOOLS-AC-002`, `TOOLS-AC-003`

## Behavior

### `TOOLS-MCP-01` HTTP 포트 생성

- Trigger: `url` 속성을 포함한 옵션 전달
- Main Flow:
  - `type: 'mcp-http'` 포트를 생성한다.
  - `toMcpConfig()`는 `{ type: 'http', url, headers? }`를 반환한다.

### `TOOLS-MCP-02` stdio 포트 생성

- Trigger: `command` 속성을 포함한 옵션 전달
- Main Flow:
  - `type: 'mcp-stdio'` 포트를 생성한다.
  - `toMcpConfig()`는 `{ command, args, env? }`를 반환한다.
  - `env`가 있으면 `process.env`와 병합한다.

## Constraints

- `TOOLS-MCP-C-001`: HTTP와 stdio는 입력 유니온에서 상호 배타적으로 구분돼야 한다.
- `TOOLS-MCP-C-002`: `name`은 생성된 `McpToolPort.name`에 그대로 반영돼야 한다.
- `TOOLS-MCP-C-003`: HTTP headers가 없으면 설정 객체에 불필요한 필드를 넣지 않는다.

## Interface

- `mcpServer(options: McpServerOptions): McpToolPort`
- `McpHttpOptions`
  - `name`, `url`, `headers?`
- `McpStdioOptions`
  - `name`, `command`, `args?`, `env?`

## Realization

- 모듈 경계:
  - `mcpServer.ts`는 순수 포트 생성기다.
- 실패 처리:
  - 타입 수준에서 구분 가능한 잘못된 입력은 컴파일 단계에서 차단한다.

## Dependencies

- Depends On: [`@sena-ai/core`](/Users/channy/workspace/sena-ai/packages/core/specs/index.md) 타입 계약
- Blocks: `runtime/codex`, `runtime/claude`, 애플리케이션 MCP 도구 구성
- Parallelizable With: `tool.md` in core

## AC

- Given HTTP 옵션을 넣을 때 When `toMcpConfig()`를 호출하면 Then URL과 선택적 headers가 포함된다.
- Given stdio 옵션을 넣을 때 When `toMcpConfig()`를 호출하면 Then command/args/env 구성이 반환된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
