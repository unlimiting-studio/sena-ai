# @sena-ai/platform-node

## 한 줄 요약

Node.js 환경에서 platform-core, MySQL repository, Node runtime service를 조합해 플랫폼 HTTP 서버를 기동한다.

## 문제 정의

- platform-core는 조립 가능한 라이브러리이지만 실제 Node 서버 진입점은 환경변수 검증, DB 연결, 서버 시작, token rotation 스케줄을 함께 묶어야 한다.
- 이 진입점 계약이 문서화되지 않으면 로컬 실행과 Docker 배포, scheduler 동작, 실패 시 종료 규칙이 흔들린다.

## 목표 & 성공 지표

- 필수 환경변수 검증 후 Node runtime + MySQL repo + createApp 조합으로 서버를 시작한다.
- 10시간 주기의 config token rotation이 서버 수명주기 안에서 유지된다.
- Docker/개발 모드/DB 마이그레이션 경로가 실제 엔트리포인트와 일치한다.
- 완료 기준:
  - 엔트리포인트 조립 순서와 스케줄링 책임이 상세 스펙으로 분리된다.
  - platform-core와의 의존관계가 추적 가능하다.

## 스펙 안정성 분류

- Stable
  - 필수 환경변수, createNodeRuntime + initMySQLDb + createMySQLRepositories + createApp 조합 순서
  - 10시간 token rotation 의미
- Flexible
  - 로그 문구, Docker 빌드 단계 설명 방식
- Experimental
  - 없음

## 용어 정의

- Node Runtime: platform-core/node가 제공하는 vault, relay, crypto 구현.
- Rotation Scheduler: config token을 10시간마다 갱신하는 setInterval 작업.
- Entrypoint: src/index.ts의 main() 부트스트랩 흐름.

## 요구사항

- PLATFORM-NODE-FR-001 [Committed][Stable]: 엔트리포인트는 DATABASE_URL과 VAULT_MASTER_KEY를 필수로 검증해야 한다.
- PLATFORM-NODE-FR-002 [Committed][Stable]: Node runtime, MySQL repositories, createApp를 순서대로 조합해 HTTP 서버를 시작해야 한다.
- PLATFORM-NODE-FR-003 [Committed][Stable]: config token rotation은 10시간 간격으로 모든 workspace token을 순회해야 한다.
- PLATFORM-NODE-NFR-001 [Committed][Stable]: 부트스트랩 실패 시 프로세스는 비정상 종료해야 한다.
- PLATFORM-NODE-NFR-002 [Committed][Flexible]: PLATFORM_BASE_URL과 SLACK_WORKSPACE_ID는 기본값을 가질 수 있다.

## 수용 기준 (AC)

- PLATFORM-NODE-AC-001: Given 필수 환경변수가 없을 때 When main()이 시작되면 Then 명시적 오류와 함께 종료된다. 관련: PLATFORM-NODE-FR-001, PLATFORM-NODE-NFR-001
- PLATFORM-NODE-AC-002: Given 필수 환경변수가 있을 때 When main()이 진행되면 Then runtime, repos, app이 조합되고 serve()가 호출된다. 관련: PLATFORM-NODE-FR-002
- PLATFORM-NODE-AC-003: Given config token row가 있을 때 When 10시간 scheduler가 실행되면 Then 각 workspaceId에 대해 rotateConfigToken()이 순회 호출된다. 관련: PLATFORM-NODE-FR-003

## 의존관계 맵

- Depends On: @sena-ai/platform-core, @sena-ai/platform-core/node, @sena-ai/platform-core/db/mysql, @hono/node-server, dotenv
- Blocks: Node 기반 플랫폼 배포
- Parallelizable With: platform-worker 배포 경로

## 범위 경계 (Non-goals)

- 자체 비즈니스 로직 추가
- 멀티 프로세스 orchestration이나 worker clustering
- DB 스키마 설계 자체 변경

## 제약 & 가정

- MySQL 연결 정보와 Vault key가 부트 시점에 준비된다고 가정한다.
- token rotation은 프로세스 생존 동안만 동작한다.
- serve()는 단일 포트 HTTP 서버로 충분하다고 가정한다.

## 리스크 & 완화책

- 부트스트랩 실패 리스크: 필수 env 누락이나 DB 연결 실패로 서버가 떠지지 않을 수 있다.
  - 완화: requireEnv와 main().catch()로 fail fast 한다.
- rotation 누락 리스크: 장시간 실행 중 scheduler가 멈추면 token이 만료될 수 있다.
  - 완화: 10시간 주기 순회를 Stable 계약으로 기록한다.

## 검증 계획

- source review로 부트스트랩 순서와 fail-fast 경로를 검증한다.
- 수동 검증 시 env 누락, 정상 기동, scheduler 로그를 각각 확인한다.

## 상세 스펙

- [bootstrap.md](/Users/channy/workspace/sena-ai/packages/platform/runtime-node/specs/bootstrap.md)

## 개편 메모

- Node 배포 package를 엔트리포인트 조립 책임으로 한정하고, platform-core와의 결합 면을 명확히 했다.
