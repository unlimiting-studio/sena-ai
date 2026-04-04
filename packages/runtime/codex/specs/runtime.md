# Codex Runtime

## 한 줄 요약

`codexRuntime()`은 Codex App Server와 워커 사이의 실행 세션을 조율하며, 세션/도구/abort/steer를 포함한 턴 스트림을 표준 런타임 계약으로 변환한다.

## 상위 스펙 연결

- 관련 요구사항: `CODEX-FR-001`, `CODEX-FR-002`, `CODEX-FR-003`, `CODEX-FR-004`, `CODEX-FR-005`, `CODEX-NFR-001`, `CODEX-NFR-002`
- 관련 수용 기준: `CODEX-AC-001`, `CODEX-AC-002`, `CODEX-AC-003`, `CODEX-AC-004`

## Behavior

- Actor:
  워커가 `Runtime.createStream()`으로 Codex 런타임을 호출한다.
- Trigger:
  새 턴 시작, 세션 재개, 대기 메시지 steer, abort.
- Preconditions:
  Codex CLI 실행 가능, 필요한 도구 목록과 컨텍스트 프래그먼트가 준비되어 있어야 한다.
- Main Flow:
  1. 시스템 컨텍스트를 `baseInstructions`로 조립한다.
  2. `prepend`/`append` 프래그먼트로 사용자 메시지를 감싼다.
  3. 인라인 도구와 외부 MCP 도구를 분리한다.
  4. 인라인 도구가 있으면 로컬 HTTP MCP 서버를 기동한다.
  5. 설정 오버라이드와 함께 Codex App Server 클라이언트를 spawn/initialize한다.
  6. 세션 ID가 있으면 `threadResume`, 없으면 `threadStart` 후 `session.init`을 발행한다.
  7. `turnStart()`로 턴을 시작하고 알림 큐를 drain하며 `RuntimeEvent`를 yield한다.
  8. `tool.end` 경계에서 `pendingMessages`가 있으면 `turnSteer()`를 시도한다.
  9. 종료 또는 abort 시 프로세스와 MCP 서버를 정리한다.
- Alternative Flow:
  세션 ID가 있으면 기존 thread를 재개한다.
- Failure Modes:
  spawn 실패, JSON-RPC 요청 실패, steer 실패, 알 수 없는 Codex 오류는 `error` 이벤트나 pending message 복원으로 노출한다.

## Constraints

- `CODEX-CON-001`: 세션 ID가 없을 때만 `session.init` 이벤트를 발행한다.
  측정: 스트림 이벤트 순서 검증.
- `CODEX-CON-002`: `pendingMessages` steer 실패 시 메시지를 유실하지 않고 복원해야 한다.
  측정: 복원된 큐 상태 검증.
- `CODEX-CON-003`: abort 또는 예외 경로에서도 `client.close()`와 `bridge.close()`가 실행되어야 한다.
  측정: 종료 훅 및 테스트 더블 검증.
- `CODEX-CON-004`: 샌드박스 모드 미지정/미지원 값은 `workspace-write`로 수렴해야 한다.
  측정: 모드 변환 함수 단위 테스트.

## Interface

- 팩토리:
  `codexRuntime(options?: CodexRuntimeOptions): Runtime`
- 옵션:
  `model`, `apiKey`, `reasoningEffort`, `sandboxMode`, `approvalPolicy`, `codexBin`
- 입력 계약:
  `RuntimeStreamOptions`의 `contextFragments`, `prompt`, `sessionId`, `cwd`, `abortSignal`, `tools`, `pendingMessages`
- 출력 계약:
  `AsyncGenerator<RuntimeEvent>`
- 이벤트 규칙:
  `session.init`, `progress`, `progress.delta`, `tool.start`, `tool.end`, `result`, `error`

## Realization

- `runtime.ts`가 전체 턴 오케스트레이션을 담당한다.
- 알림은 즉시 `eventQueue`에 적재하고 메인 루프가 drain한다.
- `expectedTurnId`를 유지해 steer 이전 턴의 완료 알림을 억제한다.
- 인라인 도구는 별도 MCP 서버로 노출하고 외부 MCP는 Codex 오버라이드 문자열만 생성한다.
- 승인 요청은 블로킹 방지를 위해 자동 accept 계열 응답으로 수렴한다.

## Dependencies

- Depends On:
  [app-server-client.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/app-server-client.md), [mapper.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/mapper.md), [inline-mcp-server.md](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/inline-mcp-server.md), [@sena-ai/core](/Users/channy/workspace/sena-ai/packages/core/specs/index.md)
- Blocks:
  Codex 런타임 통합을 소비하는 워커/커넥터 경로
- Parallelizable With:
  외부 MCP 도구 정의 변경

## AC

- Given 세션 ID가 없는 턴 실행, When 런타임이 thread를 시작하면, Then `session.init` 후 결과 이벤트를 순서대로 노출한다.
- Given 세션 ID가 있는 턴 실행, When 런타임이 시작하면, Then 새 thread 생성 없이 resume 경로를 사용한다.
- Given `tool.end` 이후 대기 메시지가 존재할 때, When `turnSteer()`가 성공하면, Then 이후 완료 판정은 새 `turnId` 기준으로 이뤄진다.
- Given steer 실패가 발생할 때, When 런타임이 오류를 받으면, Then 대기 메시지는 복원되어 follow-up 턴으로 이어질 수 있다.
- Given abortSignal이 발화될 때, When 스트림이 종료되면, Then 자식 프로세스와 인라인 MCP 서버는 모두 닫힌다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
