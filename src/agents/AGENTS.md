## 디렉토리 개요

Slack 이벤트를 받아 Claude Agent SDK를 실행하고, Slack 메시지로 결과를 스트리밍/게시하는 에이전트 런타임 계층이다.

## 코드 작성 컨벤션

- Slack 쓰레드 기준으로 세션을 식별하고, Claude Agent SDK의 `resume`를 이용해 멀티턴을 유지한다.
- Slack API 호출 실패 시에도 사용자가 원인을 이해할 수 있도록 최소한의 안내 메시지를 남긴다.

