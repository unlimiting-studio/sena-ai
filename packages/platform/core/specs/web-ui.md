# Web UI & API

## 한 줄 요약

관리자는 웹 UI와 JSON API로 Slack 봇을 생성, 조회, 삭제하고 로컬 부트스트랩 정보를 얻는다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-001`, `PLATFORM-FR-004`, `PLATFORM-FR-008`
- Related AC: `PLATFORM-AC-001`, `PLATFORM-AC-004`

## Behavior

### `PLATFORM-WEB-01` 봇 생성/조회/삭제 API

- Routes:
  - `POST /api/bots`
  - `GET /api/bots/:botId`
  - `POST /api/bots/:botId/provision`
  - `DELETE /api/bots/:botId`
  - `POST /api/bots/:botId/icon`
- Main Flow:
  - 입력 검증 후 봇 레코드를 만들고 프로비저닝을 시작한다.
  - 상태 조회와 삭제, 아이콘 업로드를 제공한다.

### `PLATFORM-WEB-02` 관리 페이지

- Routes:
  - `/`
  - `/bots/new`
  - `/bots/:botId/setup`
  - `/bots/:botId/complete`
  - `/admin/bots`
  - `/admin/connections`
- Main Flow:
  - 대시보드에 봇 목록과 상태를 보여준다.
  - setup/complete 페이지에서 프로비저닝 상태와 설치/부트스트랩 안내를 제공한다.

### `PLATFORM-WEB-03` 초기 설정과 부트스트랩 스크립트

- Routes:
  - `GET /setup`
  - `POST /api/setup`
  - `GET /install.sh`
- Main Flow:
  - Slack 로그인 앱 설정을 저장한다.
  - `install.sh`는 로컬 프로젝트 초기화를 위한 shell 스크립트를 제공한다.

## Constraints

- `PLATFORM-WEB-C-001`: 보호된 페이지와 API는 auth middleware 뒤에 있어야 한다.
- `PLATFORM-WEB-C-002`: 봇 username은 영문소문자/숫자/하이픈 규칙을 따라야 한다.
- `PLATFORM-WEB-C-003`: 부트스트랩 스크립트는 connect key와 platform URL을 명시적으로 주입받아야 한다.

## Interface

- Web pages: dashboard, new bot, setup progress, completion, admin pages
- API routes: 봇 생성/조회/재프로비저닝/삭제/아이콘 업로드, setup 저장

## Realization

- 모듈 경계:
  - `web/api.ts`, `web/pages.ts`, `web/setup.ts`
- 상태 모델:
  - 봇 상태는 DB를 source of truth로 하고 setup page는 polling으로 반영한다.
- 실패 처리:
  - 프로비저닝 실패는 상태와 재시도 API로 노출한다.

## Dependencies

- Depends On: `auth.md`, `database.md`, `slack-integration.md`
- Blocks: 운영 UI
- Parallelizable With: `relay.md`

## AC

- Given 인증된 관리자가 있을 때 When `POST /api/bots`를 호출하면 Then pending 봇이 생성되고 프로비저닝이 시작된다.
- Given setup/complete 페이지를 열 때 When Slack 앱 생성 또는 OAuth가 완료되면 Then 다음 단계 안내가 반영된다.
- Given `GET /install.sh`를 호출할 때 When 필요한 인자를 전달하면 Then 로컬 부트스트랩용 shell 스크립트를 받을 수 있다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

