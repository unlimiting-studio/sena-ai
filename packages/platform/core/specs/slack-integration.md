# Slack Integration

## 한 줄 요약

Slack 앱 프로비저닝, OAuth 설치, Events API 수신을 플랫폼 도메인 규칙에 맞게 처리한다.

## 상위 스펙 연결

- Related Requirements: `PLATFORM-FR-003`, `PLATFORM-FR-005`, `PLATFORM-NFR-003`
- Related AC: `PLATFORM-AC-003`

## Behavior

### `PLATFORM-SLACK-01` 앱 프로비저닝

- Trigger: 봇 생성 또는 재프로비저닝
- Main Flow:
  - workspace의 Config Token을 읽는다.
  - manifest 템플릿에 봇 이름, 이벤트 URL, redirect URL을 주입한다.
  - Slack App Manifest API로 앱을 생성한다.
  - app/client/signing secret 정보를 저장한다.

### `PLATFORM-SLACK-02` 봇 OAuth 설치

- Trigger: `/oauth/start/:botId` -> `/oauth/callback`
- Main Flow:
  - state를 만들고 authorize URL로 보낸다.
  - callback에서 state를 소비하고 `oauth.v2.access`로 봇 토큰을 얻는다.
  - 봇 토큰을 암호화 저장하고 봇 상태를 active로 바꾼다.

### `PLATFORM-SLACK-03` Events API 수신

- Trigger: `POST /slack/events/:botId`
- Main Flow:
  - active 봇 조회 및 signing secret 검증을 수행한다.
  - `url_verification`이면 challenge를 반환한다.
  - `event_callback`이면 relay로 전달하고 Slack에는 즉시 `{ ok: true }`를 응답한다.

### `PLATFORM-SLACK-04` Config Token 갱신

- Trigger: 주기적 스케줄 또는 런타임별 bootstrap 로직
- Main Flow:
  - refresh token으로 새 access/refresh token을 발급받아 저장한다.

## Constraints

- `PLATFORM-SLACK-C-001`: 이벤트 서명 검증은 5분 이내 요청과 HMAC-SHA256 비교를 사용해야 한다.
- `PLATFORM-SLACK-C-002`: OAuth state는 일회용이어야 한다.
- `PLATFORM-SLACK-C-003`: Slack Events API는 3초 내 응답 가능 구조여야 한다.

## Interface

- Routes:
  - `GET /oauth/start/:botId`
  - `GET /oauth/callback`
  - `POST /slack/events/:botId`
- Provisioner:
  - `rotateConfigToken(workspaceId)`
  - `createApp(workspaceId, botId, botName, botUsername)`
  - `deleteApp(workspaceId, appId)`

## Realization

- 모듈 경계:
  - `slack/provisioner.ts`, `slack/oauth.ts`, `slack/events.ts`로 나눈다.
- 실패 처리:
  - Slack 앱 삭제 실패는 DB 삭제를 막지 않는다.
  - 이벤트 전달 실패는 Slack 재시도와는 별개로 플랫폼 로그에 남긴다.

## Dependencies

- Depends On: `database.md`, `relay.md`, `vault.md`, `runtime.md`
- Blocks: `web-ui.md`, `platform-node`, `platform-worker`
- Parallelizable With: `auth.md`

## AC

- Given Config Token이 있을 때 When 프로비저닝을 실행하면 Then Slack 앱 생성 결과가 DB에 반영된다.
- Given OAuth callback이 성공할 때 When bot token을 받으면 Then 봇 상태가 active로 전환된다.
- Given Slack 이벤트가 들어올 때 When 서명 검증이 통과하면 Then 이벤트는 relay에 전달되고 Slack에는 즉시 응답한다.
## 개편 메모

- AGENTS.md 가이드에 맞춰 상위/상세 스펙 섹션과 traceability를 정규화했다.
- 기존 구현 계약을 바꾸지 않고 문서 구조와 검증 기준을 명확히 재배치했다.

