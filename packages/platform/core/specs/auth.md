# Auth & Session

## 한 줄 요약

관리 웹 UI 접근을 Slack OpenID Connect 로그인과 Vault 암호화 세션 쿠키로 보호한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-001`, `PLATFORM-FR-004`, `PLATFORM-FR-005`
- Related AC: `PLATFORM-AC-001`, `PLATFORM-AC-004`, `PLATFORM-AC-005`

## Behavior

### `PLATFORM-AUTH-01` 초기 설정과 접근 제어

- Trigger: `/setup` 또는 보호된 라우트 접근
- Main Flow:
  - 로그인 앱 설정이 없으면 setup 흐름으로 유도한다.
  - 설정이 이미 있으면 허용된 워크스페이스 세션이 있는 사용자만 setup에 접근할 수 있다.

### `PLATFORM-AUTH-02` Slack OpenID Connect 로그인

- Trigger: `/auth/login` -> `/auth/callback`
- Main Flow:
  - authorize URL로 리다이렉트한다.
  - state를 저장소에 만들고 10분 제한을 둔다.
  - callback에서 state를 소비하고 token/userInfo를 조회한다.
  - 허용 워크스페이스를 확인하고 세션 쿠키를 발급한다.

### `PLATFORM-AUTH-03` 세션 검증과 로그아웃

- Trigger: 보호된 웹/API 라우트 접근 또는 `/auth/logout`
- Main Flow:
  - 세션 쿠키를 Vault로 복호화해 구조와 만료를 검증한다.
  - 사용자 workspace가 허용 목록에 속하면 컨텍스트에 user/session을 주입한다.
  - 로그아웃 시 쿠키를 제거하고 로그인 페이지로 보낸다.

## Constraints

- `PLATFORM-AUTH-C-001`: 세션 쿠키는 `httpOnly`, `secure`, `sameSite=Lax`, `path=/`를 유지해야 한다.
- `PLATFORM-AUTH-C-002`: state는 일회용이어야 하며 만료된 값은 허용하면 안 된다.
- `PLATFORM-AUTH-C-003`: 보호된 API 경로와 웹 경로는 실패 응답 형식이 구분돼야 한다.

## Interface

- Routes:
  - `GET /auth/login`
  - `GET /auth/callback`
  - `POST /auth/logout`
  - `GET/POST /setup`, `/api/setup`
- Session Types:
  - `AuthSession`
  - `AuthSessionUser`
- Helper/API:
  - `createAuthHandler(...)`
  - `createAuthMiddleware(...)`
  - `createSessionCookieValue(...)`
  - `parseSessionCookieValue(...)`

## Realization

- 모듈 경계:
  - `auth/handler.ts`가 라우트와 middleware를 담당하고 `auth/session.ts`가 쿠키 직렬화를 맡는다.
- 상태 모델:
  - OAuth state는 저장소에, 세션은 Vault 암호화 쿠키에 저장한다.
- 실패 처리:
  - 인증 실패는 API JSON 또는 웹 redirect/error page로 분리해 응답한다.

## Dependencies

- Depends On: `vault.md`, `database.md`, `runtime.md`
- Blocks: `web-ui.md`, 보호된 API
- Parallelizable With: `slack-integration.md`

## AC

- Given 로그인 앱 설정이 없을 때 When 관리 UI에 접근하면 Then setup 페이지로 이동한다.
- Given 유효한 Slack 로그인 callback이 올 때 When state와 workspace 검증이 통과하면 Then 세션 쿠키가 발급된다.
- Given 보호된 API 경로 접근 시 세션이 없을 때 When 요청하면 Then JSON 에러와 redirect 정보가 반환된다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

