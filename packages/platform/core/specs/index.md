# @sena-ai/platform-core

## 한 줄 요약

멀티테넌트 sena-ai 플랫폼의 웹 앱, Slack 프로비저닝, 인증, 릴레이, 비밀 저장, DB, 런타임 추상화를 하나의 코어 라이브러리로 제공한다.

## 문제 정의

- 로컬 봇 런타임이 Slack 토큰 없이 플랫폼을 경유하도록 만들려면 릴레이/API 프록시, Vault, 인증, 프로비저닝이 함께 설계돼야 한다.
- Node.js와 Cloudflare Workers라는 서로 다른 런타임에서 동일한 플랫폼 계약을 유지하지 않으면 운영 경로가 분기된다.
- 관리자 UI, Slack OAuth, 이벤트 릴레이, DB 저장소가 따로 정의되면 워크스페이스 격리와 토큰 보안이 쉽게 깨질 수 있다.

## 목표 & 성공 지표

- 플랫폼 핵심 로직을 `Platform` 인터페이스와 `createApp()` 조합으로 런타임 독립적으로 제공한다.
- Slack 봇 생성/설치/이벤트 수신/릴레이/API 프록시/관리 UI/인증이 하나의 패키지에서 추적 가능해야 한다.
- 완료 기준:
  - 상위 스펙이 플랫폼의 목표, 경계, 보안 원칙, 런타임 독립성을 명시한다.
  - 각 도메인 스펙이 상위 FR/NFR/AC를 참조한다.
  - 실제 소스의 라우트, 저장소, 암호화, 릴레이 의미와 문서가 일치한다.

## 스펙 안정성 분류

- `Stable`
  - Zero Token Exposure 원칙
  - Slack OAuth/Events/Relay/API Proxy의 외부 계약
  - Vault 암호화 포맷과 워크스페이스 격리 규칙
- `Flexible`
  - 관리 UI 렌더링 세부 구조, 로그 문구, 부트스트랩 스크립트 UX
- `Experimental`
  - PostgreSQL 사용 확장, 추가 운영 API, 배포 토폴로지 확장

## 용어 정의

- `Platform`: 런타임 독립 서비스 조합 인터페이스.
- `RelayHub`: 봇 런타임 연결 관리와 이벤트 디스패치를 담당하는 계층.
- `connect_key`: 로컬 봇 런타임이 플랫폼에 인증할 때 쓰는 봇별 연결 키.
- `Config Token`: Slack App Manifest API를 호출하기 위한 워크스페이스 단위 토큰.
- `Workspace Admin Config`: 관리 UI 로그인 앱과 Slack 웹 API 접근 설정.

## 요구사항

- `PLATFORM-FR-001 [Committed][Stable]`: `createApp()`은 인증, Slack, 릴레이, 웹 UI, API를 하나의 Hono 앱으로 조립해야 한다.
- `PLATFORM-FR-002 [Committed][Stable]`: 플랫폼은 로컬 봇 런타임에 이벤트를 전달하고 Slack API를 프록시해야 한다.
- `PLATFORM-FR-003 [Committed][Stable]`: Slack 앱 생성/설치/삭제와 이벤트 수신을 지원해야 한다.
- `PLATFORM-FR-004 [Committed][Stable]`: 관리 UI 접근은 Slack OpenID Connect와 세션 쿠키로 보호되어야 한다.
- `PLATFORM-FR-005 [Committed][Stable]`: 민감 정보는 Vault로 암호화되어 저장돼야 한다.
- `PLATFORM-FR-006 [Committed][Stable]`: MySQL, PostgreSQL, D1에 대해 동일한 Repository 계약을 제공해야 한다.
- `PLATFORM-FR-007 [Committed][Stable]`: Node.js와 Cloudflare Workers 런타임 구현을 동일한 플랫폼 계약으로 조합할 수 있어야 한다.
- `PLATFORM-FR-008 [Committed][Flexible]`: 웹 UI와 API는 봇 생성, 상태 확인, 삭제, 부트스트랩 스크립트 제공을 지원해야 한다.
- `PLATFORM-NFR-001 [Committed][Stable]`: 봇 런타임은 Slack 토큰을 직접 보유하면 안 된다.
- `PLATFORM-NFR-002 [Committed][Stable]`: 워크스페이스별 설정과 세션은 교차 접근되지 않아야 한다.
- `PLATFORM-NFR-003 [Committed][Stable]`: Slack Events API 응답은 3초 제한을 넘기지 않도록 즉시 응답 구조를 유지해야 한다.
- `PLATFORM-NFR-004 [Planned][Experimental]`: 플랫폼 코어는 추가 런타임/DB 조합에도 동일 계약을 유지할 수 있어야 한다.

## 수용 기준 (AC)

- `PLATFORM-AC-001`: Given 런타임 서비스와 저장소가 조합될 때 When `createApp()`을 호출하면 Then 플랫폼 라우트가 구성된 앱이 생성된다.
- `PLATFORM-AC-002`: Given 유효한 `connect_key`를 가진 봇 런타임이 연결될 때 When Slack 이벤트가 들어오면 Then 이벤트는 릴레이를 통해 해당 봇으로 전달된다.
- `PLATFORM-AC-003`: Given Config Token과 봇 정보가 있을 때 When 프로비저닝을 실행하면 Then Slack 앱 생성/OAuth/삭제 흐름이 수행된다.
- `PLATFORM-AC-004`: Given 관리 UI 접근 시 When 로그인 앱 설정과 세션 검증이 통과하면 Then 보호된 페이지/API에 접근할 수 있다.
- `PLATFORM-AC-005`: Given 토큰/시크릿/세션 값이 저장될 때 When DB 또는 쿠키에 기록되면 Then Vault 암호문 형태로 저장된다.
- `PLATFORM-AC-006`: Given Node.js 또는 CF Workers 환경일 때 When 각 런타임 팩토리를 사용하면 Then 같은 `Platform` 계약으로 앱을 실행할 수 있다.

## 의존관계 맵

- Depends On: Hono, Drizzle ORM, Slack HTTP API, 런타임별 crypto/relay 구현
- Blocks: `platform-node`, `platform-worker`, `platform-connector`
- Parallelizable With: 개별 통합/관리 UI 개선

## 범위 경계 (Non-goals)

- Slack 외 타 플랫폼 연동은 이번 범위 밖이다.
- 장기 데이터 분석, billing, 조직 관리 기능은 포함하지 않는다.
- 로컬 봇 런타임 자체 구현은 `platform-connector`와 코어 외 패키지 책임이다.

## 제약 & 가정

- Slack App Manifest API와 OpenID Connect/OAuth 2.0 가용성을 전제로 한다.
- Vault master key는 런타임별 비밀 환경 변수로 제공된다.
- Node.js는 MySQL을 기본 경로로 사용하고 PostgreSQL은 확장용 구현 상태다.

## 리스크 & 완화책

- `Risk`: 토큰이 클라이언트나 로컬 봇에 노출되면 플랫폼 보안 모델이 무너진다.
  - `완화`: API proxy와 connect_key 인증을 Stable 계약으로 명시한다.
- `Risk`: 런타임별 relay/vault 구현 차이로 동작이 갈라질 수 있다.
  - `완화`: 공통 인터페이스와 교차 런타임 호환 포맷을 문서화한다.
- `Risk`: 워크스페이스 설정 누수가 발생할 수 있다.
  - `완화`: auth/database/web-ui에서 workspace scoping을 명시한다.

## 검증 계획

- 단위 테스트 및 수동 smoke test로 OAuth, Slack Events, relay/api, 세션 쿠키, Vault 암호화, 저장소 CRUD 검증
- Node.js/CF Workers 조립 경로를 각각 배포 패키지 수준에서 검증

## 상세 스펙 맵

- [auth.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/auth.md)
- [database.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/database.md)
- [relay.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/relay.md)
- [runtime.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/runtime.md)
- [slack-integration.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/slack-integration.md)
- [vault.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/vault.md)
- [web-ui.md](/Users/channy/workspace/sena-ai/packages/platform/core/specs/web-ui.md)
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.
