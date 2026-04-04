# @sena-ai/runtime-codex

## 한 줄 요약

OpenAI Codex CLI App Server 모드를 sena-ai `Runtime` 계약으로 감싸고, JSON-RPC 클라이언트와 인라인 MCP 서버로 코어 실행 흐름에 연결한다.

## 문제 정의

- Codex CLI는 별도 자식 프로세스와 JSON-RPC 알림 체계를 사용하므로 코어 런타임 계약과 직접 맞지 않는다.
- 코어 인라인 도구와 MCP 도구를 Codex 설정 오버라이드로 연결하려면 별도 구성 계층이 필요하다.

## 목표 & 성공 지표

- `codexRuntime()`이 코어 `Runtime` 인터페이스를 구현한다.
- Codex 알림을 `RuntimeEvent`로 매핑한다.
- inline bridge URL과 MCP 서버 구성을 Codex App Server 설정 오버라이드로 주입한다.

## 스펙 안정성 분류

- `Stable`: JSON-RPC client contract, `RuntimeEvent` 매핑, steer/abort 의미
- `Flexible`: config override 문자열 조립 방식, 로그 포맷
- `Experimental`: Codex approval request 정책 확장, reasoning effort 전달

## 용어 정의

- `App Server Client`: Codex CLI와 JSON-RPC over stdio로 통신하는 클라이언트.
- `Inline MCP Server`: 인라인 도구를 Codex가 호출할 수 있게 하는 로컬 HTTP MCP 서버.

## 요구사항

- `CODEX-FR-001 [Committed][Stable]`: 런타임은 코어 `Runtime` 인터페이스를 구현해야 한다.
- `CODEX-FR-002 [Committed][Stable]`: Codex 알림을 `RuntimeEvent`로 매핑해야 한다.
- `CODEX-FR-003 [Committed][Stable]`: App Server와 JSON-RPC 요청/응답/알림 계약을 처리해야 한다.
- `CODEX-FR-004 [Committed][Stable]`: 인라인/MCP 도구를 Codex 설정 오버라이드로 주입해야 한다.
- `CODEX-FR-005 [Committed][Stable]`: 세션 재개, steer, abort, approval request 처리를 지원해야 한다.
- `CODEX-NFR-001 [Committed][Stable]`: 자식 프로세스와 로컬 MCP 서버는 종료 시 정리되어야 한다.
- `CODEX-NFR-002 [Planned][Experimental]`: `reasoningEffort`는 향후 Codex 설정으로 실제 전달될 수 있게 남겨둔다.

## 수용 기준 (AC)

- `CODEX-AC-001`: Given `codexRuntime()`이 생성될 때 When 코어가 `createStream()`을 호출하면 Then `RuntimeEvent` 스트림을 받는다.
- `CODEX-AC-002`: Given Codex 알림이 도착할 때 When 매퍼가 처리하면 Then progress/tool/result/error 의미가 보존된다.
- `CODEX-AC-003`: Given 인라인 도구나 MCP 도구가 있을 때 When 런타임을 시작하면 Then 설정 오버라이드에 해당 구성이 포함된다.
- `CODEX-AC-004`: Given 세션 ID, pending message, abort signal, approval request가 있을 때 When 런타임이 실행되면 Then 각 흐름이 정의된 방식으로 처리된다.

## 의존관계 맵

- Depends On: `@sena-ai/core`, Codex CLI, MCP SDK
- Blocks: Codex 기반 에이전트 실행
- Parallelizable With: `runtime/claude`

## 범위 경계 (Non-goals)

- Codex CLI 내부 명령 semantics 자체를 재정의하지 않는다.
- approval request를 사람에게 중계하는 UI는 포함하지 않는다.

## 제약 & 가정

- 실행 환경에 `codex` 바이너리 또는 지정된 `codexBin`이 존재해야 한다.
- inline MCP 서버는 로컬 HTTP 포트를 열 수 있어야 한다.

## 리스크 & 완화책

- `Risk`: Codex 알림 포맷 변경 시 매핑이 깨질 수 있다.
  - `완화`: mapper/unit test와 명시적 표를 유지한다.
- `Risk`: child process 종료나 MCP 서버 정리 누락으로 리소스 누수가 생길 수 있다.
  - `완화`: close 경로를 Stable 계약으로 문서화한다.

## 검증 계획

- `mapper.test.ts`로 알림 매핑 검증
- `configOverrides.test.ts`로 override 조립 검증
- `inline-mcp-server.test.ts`로 로컬 MCP 서버 동작 검증

## 상세 스펙 맵

- [runtime.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/runtime.md)
- [mapper.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/mapper.md)
- [app-server-client.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/app-server-client.md)
- [inline-mcp-server.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/inline-mcp-server.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
