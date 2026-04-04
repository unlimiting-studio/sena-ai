# Slack Signature Verification

## 한 줄 요약

HTTP Events API 모드에서 Slack 요청이 진짜인지 HMAC-SHA256 기반으로 검증한다.

## 상위 스펙 연결

- Related Requirements: `SLACK-CONN-FR-006`
- Related AC: `SLACK-CONN-AC-006`

## Behavior

### `SLACK-VERIFY-01` 서명 검증

- Trigger: HTTP 이벤트 수신
- Main Flow:
  - timestamp와 signature 존재를 확인한다.
  - 현재 시각 기준 5분 내 요청인지 본다.
  - `v0:{timestamp}:{rawBody}` 문자열에 HMAC-SHA256을 계산한다.
  - timing-safe 비교로 요청 서명과 대조한다.

## Constraints

- `SLACK-VERIFY-C-001`: timestamp 허용 범위는 ±5분이다.
- `SLACK-VERIFY-C-002`: signature 또는 timestamp가 없으면 무조건 false다.
- `SLACK-VERIFY-C-003`: 길이 불일치 등 timing safe compare 오류는 false로 처리한다.

## Interface

- `verifySignature(signingSecret, timestamp, rawBody, signature): boolean`

## Realization

- 모듈 경계:
  - `verify.ts`는 순수 검증 함수다.

## Dependencies

- Depends On: Node crypto
- Blocks: HTTP mode connector
- Parallelizable With: `mrkdwn.md`

## AC

- Given 유효한 timestamp와 signature가 있을 때 When `verifySignature()`를 호출하면 Then true를 반환한다.
- Given 만료되었거나 잘못된 서명이 올 때 When 호출하면 Then false를 반환한다.

## 개편 메모

- AGENTS.md 가이드 정렬을 위해 서명 검증의 경계와 AC를 명시했다.
