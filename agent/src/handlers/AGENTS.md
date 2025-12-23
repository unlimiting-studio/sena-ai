## 디렉토리 개요

Slack interactivity(버튼/모달 등) 처리 핸들러를 둔다.

## 코드 작성 컨벤션

- handler는 idempotent(중복 호출 방지)하거나, 최소한 중복 실행 시 안전하도록 작성한다.
- 사용자의 Slack userId와 link token의 slackUserId가 일치하는지 검증한다.

