# Node Platform Bootstrap

## 한 줄 요약

Node.js entrypoint는 환경변수, runtime, DB, app, rotation scheduler, HTTP server를 순서대로 조립한다.

## 상위 스펙 연결

- 관련 요구사항: `PLATFORM-NODE-FR-001`, `PLATFORM-NODE-FR-002`, `PLATFORM-NODE-FR-003`, `PLATFORM-NODE-NFR-001`, `PLATFORM-NODE-NFR-002`
- 관련 수용 기준: `PLATFORM-NODE-AC-001`, `PLATFORM-NODE-AC-002`, `PLATFORM-NODE-AC-003`

## Behavior

- Trigger:
  `src/index.ts`가 프로세스 시작 시 `main()`을 실행한다.
- Main Flow:
  1. `PORT`, `DATABASE_URL`, `VAULT_MASTER_KEY`, `PLATFORM_BASE_URL`, `SLACK_WORKSPACE_ID`를 해석한다.
  2. `createNodeRuntime()`으로 vault/relay/crypto를 만든다.
  3. `initMySQLDb()`와 `createMySQLRepositories()`로 DB 레이어를 만든다.
  4. runtime과 repos를 합쳐 platform 객체를 만든다.
  5. `createApp()`으로 Hono app과 provisioner를 만든다.
  6. 10시간 주기 rotation scheduler를 등록한다.
  7. `@hono/node-server`로 HTTP 서버를 연다.
- Failure Modes:
  필수 env 누락이나 초기화 오류는 `main().catch()` 경로로 종료된다.

## Constraints

- `PLATNODE-CON-001`: `requireEnv()`가 필요한 변수 누락을 즉시 예외로 바꿔야 한다.
- `PLATNODE-CON-002`: rotation 실패는 개별 workspace에 국한되어야 한다.
- `PLATNODE-CON-003`: dev/Docker 모두 같은 entrypoint 조립 의미를 유지해야 한다.

## Interface

- 환경변수:
  `PORT`, `DATABASE_URL`, `VAULT_MASTER_KEY`, `PLATFORM_BASE_URL`, `SLACK_WORKSPACE_ID`
- 외부 실행 표면:
  Node 프로세스 entrypoint `src/index.ts`

## Realization

- rotation scheduler는 `setInterval()`로 구현한다.
- 서버는 `serve({ fetch: app.fetch, port })` 패턴을 사용한다.
- startup logging은 base URL과 listen port를 출력한다.

## Dependencies

- Depends On:
  [platform-core](/Users/channy/workspace/sena-ai/packages/platform/core/specs/index.md), MySQL driver, Hono Node server
- Blocks:
  Node 배포 경로 전반
- Parallelizable With:
  Docker/image 운영 문서

## AC

- Given 유효한 env와 DB, When entrypoint가 실행되면, Then HTTP 서버가 지정 포트에서 listening 상태가 된다.
- Given 하나의 workspace token rotation이 실패할 때, When scheduler가 실행되면, Then 다음 workspace rotation은 계속 수행된다.
- Given 필수 env 누락, When `main()`이 시작되면, Then 프로세스는 실패 로그 후 exit code 1로 종료한다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 섹션 구조와 추적 가능성을 보강했다.
