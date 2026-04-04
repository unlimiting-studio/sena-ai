# Codex App Server Client

## 한 줄 요약

managed Codex CLI `app-server` 프로세스와 JSON-RPC 요청/응답/알림을 주고받는 클라이언트다.

## 상위 스펙 연결

- Related Requirements: `CODEX-FR-003`, `CODEX-FR-005`
- Related AC: `CODEX-AC-004`

## Behavior

### `CODEX-CLIENT-01` 프로세스 기동과 초기화

- Trigger: `spawn(configOverrides?)` 후 `initialize()`
- Main Flow:
  - 명시적 `codexBin` override가 있으면 그 값을, 없으면 공식 `@openai/codex` 패키지에서 해상한 managed executable을 사용한다.
  - `codex app-server` 자식 프로세스를 실행한다.
  - 실행 파일이 JS 엔트리포인트이면 현재 Node 실행 파일로 감싸서 기동한다.
  - stdin/stdout을 JSON-RPC 채널로 사용한다.
  - client capability에 `experimentalApi: true`를 포함해 initialize를 수행한다.

### `CODEX-CLIENT-02` thread/turn 제어

- Main Flow:
  - `threadStart`, `threadResume`, `turnStart`, `turnSteer` 요청을 지원한다.
  - 응답에서 `threadId`, `turnId`를 반환한다.

### `CODEX-CLIENT-03` 알림/서버 요청 처리

- Trigger: Codex가 notification 또는 request 메시지를 보냄
- Main Flow:
  - notification은 이벤트 emitter로 전달한다.
  - server-request는 응답이 필요하므로 별도 이벤트로 노출한다.

## Constraints

- `CODEX-CLIENT-C-001`: request id별 pending promise를 정확히 매칭해야 한다.
- `CODEX-CLIENT-C-002`: 프로세스 종료 시 대기 중 요청은 reject 되어야 한다.
- `CODEX-CLIENT-C-003`: notification, server-request, exit 이벤트는 순서대로 외부에 전달돼야 한다.
- `CODEX-CLIENT-C-004`: 기본 실행 경로는 PATH 검색이 아니라 공식 `@openai/codex` 패키지에서 해상되어야 한다.
- `CODEX-CLIENT-C-005`: JS 엔트리포인트를 직접 실행하지 않고 Node 런타임을 통해 기동해야 한다.

## Interface

- `CodexAppServerClient`
  - `constructor(codexBin?)`
  - `spawn(configOverrides?)`
  - `initialize(clientName?, version?)`
  - `threadStart(params)`
  - `threadResume(threadId, params?)`
  - `turnStart(threadId, text, params?)`
  - `turnSteer(threadId, text, expectedTurnId)`
  - `request(method, params)`
  - `notify(method, params?)`
  - `respond(id, result)`
  - `close()`
- Events:
  - `notification`
  - `server-request`
  - `spawn-error`
  - `exit`

## Realization

- 모듈 경계:
  - `client.ts`가 child process, readline, pending request Map을 관리한다.
  - `managed-codex.ts`가 공식 패키지 경로 해상과 spawn invocation 조립을 담당한다.
- 상태 모델:
  - 증가하는 request id와 pending promise Map을 유지한다.
- 실패 처리:
  - JSON parse 실패나 프로세스 종료는 pending request reject로 이어진다.
  - managed executable 해상 실패는 spawn 이전 명시적 예외로 표면화한다.

## Dependencies

- Depends On: Node.js `child_process`, `readline`, `events`
- Blocks: [`runtime.md`](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/runtime.md)
- Parallelizable With: [`inline-mcp-server.md`](/Users/channy/workspace/sena-ai/packages/runtime/codex/specs/inline-mcp-server.md)

## AC

- Given client를 spawn/initialize 할 때 When Codex CLI가 응답하면 Then thread/turn 요청을 보낼 수 있다.
- Given server-request가 오면 When 외부가 `respond()`를 호출하면 Then JSON-RPC 응답이 전송된다.
- Given 프로세스가 종료되면 When 대기 중 요청이 있으면 Then 모두 reject 된다.
- Given `codexBin` override가 없을 때, When client가 spawn 되면, Then 공식 `@openai/codex` 패키지의 managed executable 경로가 사용된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
