# @sena-ai/runtime-claude

## 한 줄 요약

Anthropic Claude Agent SDK를 sena-ai `Runtime` 계약으로 감싸고, 도구 브릿지와 이벤트 매핑을 통해 코어 턴 엔진에 연결한다.

## 문제 정의

- Claude SDK는 자체 메시지 포맷과 도구 실행 모델을 사용하므로 코어의 `RuntimeEvent` 계약으로 직접 연결되지 않는다.
- 인라인 도구와 외부 MCP 도구를 동시에 쓰려면 SDK가 이해하는 MCP 서버 구성과 코어 도구 계약 사이에 브릿지가 필요하다.

## 목표 & 성공 지표

- `claudeRuntime()` 하나로 코어 `Runtime` 계약을 만족한다.
- SDK 메시지는 `RuntimeEvent`로 일관되게 매핑된다.
- 인라인 도구는 로컬 HTTP MCP 브릿지를 통해 Claude SDK가 호출할 수 있다.

## 스펙 안정성 분류

- `Stable`
  - `RuntimeEvent` 매핑 의미
  - 세션 재개, steer, abort의 외부 관찰 동작
- `Flexible`
  - 디버그 로그 포맷, MCP 서버 요약 출력
- `Experimental`
  - reconnect heuristics와 허용 도구 기본 목록의 확장

## 용어 정의

- `SDK Message Mapper`: Claude SDK 메시지를 `RuntimeEvent`로 바꾸는 매퍼.
- `Inline MCP Bridge`: 인라인 도구를 SDK가 MCP 서버처럼 호출하게 만드는 로컬 HTTP 서버.

## 요구사항

- `CLAUDE-FR-001 [Committed][Stable]`: 런타임은 코어 `Runtime` 인터페이스를 구현해야 한다.
- `CLAUDE-FR-002 [Committed][Stable]`: SDK 메시지를 `RuntimeEvent`로 매핑해야 한다.
- `CLAUDE-FR-003 [Committed][Stable]`: 인라인 도구와 MCP 도구를 함께 사용할 수 있어야 한다.
- `CLAUDE-FR-004 [Committed][Stable]`: 세션 재개, steer, abort를 지원해야 한다.
- `CLAUDE-FR-005 [Committed][Flexible]`: 허용/비허용 도구 목록을 런타임 옵션과 턴 옵션으로 조합해야 한다.
- `CLAUDE-NFR-001 [Committed][Stable]`: 인라인 브릿지 정리와 예외 처리로 리소스 누수를 막아야 한다.

## 수용 기준 (AC)

- `CLAUDE-AC-001`: Given `claudeRuntime()`로 생성한 런타임이 있을 때 When 코어가 `createStream()`을 호출하면 Then `RuntimeEvent` 스트림을 받는다.
- `CLAUDE-AC-002`: Given SDK 메시지가 들어올 때 When 매퍼가 이를 처리하면 Then session/progress/tool/result/error 의미가 보존된다.
- `CLAUDE-AC-003`: Given 인라인 도구가 포함될 때 When 런타임을 시작하면 Then 로컬 MCP 브릿지가 떠서 SDK가 도구를 호출할 수 있다.
- `CLAUDE-AC-004`: Given 세션 ID 또는 pending message가 있을 때 When 런타임이 이를 실행하면 Then resume/steer 경로가 동작한다.

## 의존관계 맵

- Depends On: `@sena-ai/core`, Claude Agent SDK, MCP SDK
- Blocks: Claude 기반 에이전트 실행
- Parallelizable With: `runtime/codex`

## 범위 경계 (Non-goals)

- Claude SDK 내부 프로토콜 자체를 재정의하지 않는다.
- 멀티턴 스케줄링 정책이나 세션 저장 정책은 코어 worker 책임이다.

## 제약 & 가정

- SDK는 단일 프롬프트 턴 흐름을 중심으로 사용된다.
- 인라인 브릿지는 로컬 HTTP 서버를 열 수 있는 환경을 가정한다.

## 리스크 & 완화책

- `Risk`: SDK 메시지 형식 변경 시 매핑이 깨질 수 있다.
  - `완화`: mapper 테스트와 명시적 매핑 표를 유지한다.
- `Risk`: 브릿지 트랜스포트가 닫히면 인라인 도구 호출이 실패할 수 있다.
  - `완화`: dirty signal 기반 재연결/리셋 규칙을 명시한다.

## 검증 계획

- `mapper.test.ts`로 메시지 매핑 검증
- `buildToolConfig.test.ts`로 도구 구성/핸들러 래핑 검증
- 수동 smoke test로 resume/steer/abort와 브릿지 동작 검증

## 상세 스펙 맵

- [runtime.md](/Users/channy/workspace/sena-ai/packages/runtime/claude/specs/runtime.md)
- [mapper.md](/Users/channy/workspace/sena-ai/packages/runtime/claude/specs/mapper.md)
- [inline-mcp-bridge.md](/Users/channy/workspace/sena-ai/packages/runtime/claude/specs/inline-mcp-bridge.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
