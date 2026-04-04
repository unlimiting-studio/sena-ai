# Database

## 한 줄 요약

플랫폼 코어는 봇, 토큰, OAuth state, 워크스페이스 설정을 공통 Repository 계약으로 저장한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-005`, `PLATFORM-FR-006`
- Related AC: `PLATFORM-AC-005`

## Behavior

### `PLATFORM-DB-01` 봇/토큰/설정 저장

- `bots`: 봇 메타데이터와 암호화된 Slack 자격 증명 저장
- `config_tokens`: 워크스페이스별 Config Token 저장
- `oauth_states`: OAuth state의 생성/소비/만료 정리
- `workspace_admin_config`: Slack 로그인 앱과 웹 API 설정 저장

### `PLATFORM-DB-02` 공통 Repository 계약

- MySQL, PostgreSQL, D1 구현은 동일한 Repository 메서드 집합을 제공한다.

### `PLATFORM-DB-03` 런타임별 DB 초기화

- Node.js는 MySQL을 기본 경로로 사용한다.
- PostgreSQL은 동일 계약의 확장 경로다.
- CF Workers는 D1 구현을 사용한다.

## Constraints

- `PLATFORM-DB-C-001`: 민감 컬럼은 평문이 아닌 암호문 저장을 전제로 한다.
- `PLATFORM-DB-C-002`: state consume는 읽기 후 삭제 semantics를 가져야 한다.
- `PLATFORM-DB-C-003`: workspace별 설정은 workspace id 기준으로 격리되어야 한다.

## Interface

- Repository Contracts:
  - `BotRepository`
  - `ConfigTokenRepository`
  - `OAuthStateRepository`
  - `WorkspaceAdminConfigRepository`
- DB Factories:
  - `initMySQLDb`, `createMySQLRepositories`
  - `initPostgreSQLDb`, `createPostgreSQLRepositories`
  - `initD1`, `createD1Repositories`

## Realization

- 모듈 경계:
  - DB별 schema/index 구현이 동일한 Repository 인터페이스를 만족한다.
- 상태 모델:
  - DB별 timestamp/enum/upsert 차이를 각 adapter 내부에 캡슐화한다.
- 마이그레이션:
  - Node.js는 drizzle-kit, CF Workers는 SQL migration 파일을 사용한다.

## Dependencies

- Depends On: Drizzle ORM, `vault.md`
- Blocks: `auth.md`, `slack-integration.md`, `web-ui.md`
- Parallelizable With: `runtime.md`

## AC

- Given 봇 또는 토큰 데이터를 저장할 때 When Repository를 사용하면 Then 각 DB 구현이 동일한 메서드 계약을 제공한다.
- Given OAuth state를 소비할 때 When 동일 state를 다시 읽으려 하면 Then 일회용 semantics 때문에 실패한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

