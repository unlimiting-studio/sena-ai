## 디렉토리 개요

HTTP 라우트(Fastify plugin) 모음이다.

## 코드 작성 컨벤션

- Slack 서명 검증은 raw body 기반으로 처리한다.
- OAuth 콜백은 사용자에게 HTML로 성공/실패를 안내한다.
- side-effect가 있는 작업은 응답(ack) 후 비동기로 처리해 Slack 3초 타임아웃을 피한다.

