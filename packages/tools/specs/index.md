# @sena-ai/tools

## 한 줄 요약

외부 MCP 서버를 sena-ai의 `ToolPort` 계약으로 연결하는 최소 어댑터를 제공한다.

## 문제 정의

- 런타임은 MCP 서버와 직접 통신할 수 있지만, 애플리케이션 코드는 HTTP/stdio 차이를 추상화한 도구 선언이 필요하다.
- 도구 패키지가 런타임별 설정 형식을 직접 만들면 공급자별 설정 오버라이드가 퍼져 나간다.

## 목표 & 성공 지표

- HTTP 기반과 stdio 기반 MCP 서버를 동일한 `mcpServer()` API로 정의할 수 있다.
- 런타임이 `toMcpConfig(runtimeInfo)`만 호출해 연결 정보를 얻을 수 있다.

## 스펙 안정성 분류

- `Stable`: `McpToolPort` 계약과 HTTP/stdio 입력 형식
- `Flexible`: 런타임별 부가 메타데이터 해석
- `Experimental`: 추가 전송 방식 확장

## 용어 정의

- `MCP Server`: Model Context Protocol로 외부 도구를 노출하는 서버.
- `McpToolPort`: 런타임이 연결 구성을 얻기 위해 소비하는 도구 포트.

## 요구사항

- `TOOLS-FR-001 [Committed][Stable]`: HTTP URL 기반 MCP 서버를 `McpToolPort`로 표현해야 한다.
- `TOOLS-FR-002 [Committed][Stable]`: stdio command 기반 MCP 서버를 `McpToolPort`로 표현해야 한다.
- `TOOLS-FR-003 [Committed][Stable]`: 런타임은 동일한 `toMcpConfig()` 호출만으로 두 전송 방식을 소비할 수 있어야 한다.
- `TOOLS-NFR-001 [Committed][Stable]`: 입력 선언은 특정 런타임 구현에 결합되지 않아야 한다.

## 수용 기준 (AC)

- `TOOLS-AC-001`: Given HTTP MCP 서버 옵션을 전달할 때 When `mcpServer()`를 호출하면 Then `type: 'mcp-http'` 도구 포트가 생성된다.
- `TOOLS-AC-002`: Given stdio MCP 서버 옵션을 전달할 때 When `mcpServer()`를 호출하면 Then `type: 'mcp-stdio'` 도구 포트가 생성된다.
- `TOOLS-AC-003`: Given 런타임이 `toMcpConfig()`를 호출할 때 When HTTP/stdio 도구를 소비하면 Then 각 전송 방식에 맞는 설정 객체를 얻는다.

## 의존관계 맵

- Depends On: `@sena-ai/core`
- Blocks: `runtime/*`, 애플리케이션 도구 선언
- Parallelizable With: 개별 런타임 패키지

## 범위 경계 (Non-goals)

- MCP 서버 자체 구현이나 프로토콜 핸드셰이크는 포함하지 않는다.
- 인증 토큰 회전이나 연결 재시도 정책은 런타임 책임이다.

## 제약 & 가정

- stdio 도구는 실행 가능한 command와 선택적 args/env를 가진다.

## 리스크 & 완화책

- `Risk`: 런타임별 설정 키가 달라지면 공통 계약이 흔들릴 수 있다.
  - `완화`: 상위 계약은 `toMcpConfig()` 반환 구조까지만 고정한다.

## 검증 계획

- `mcpServer.test.ts`로 HTTP/stdio 포트 생성과 옵션 반영을 검증

## 상세 스펙 맵

- [mcp-server.md](/Users/channy/workspace/sena-ai/packages/tools/specs/mcp-server.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
