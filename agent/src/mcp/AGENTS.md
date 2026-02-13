## 디렉토리 개요

Claude Agent SDK에 주입할 커스텀 MCP 서버(tool) 정의와 Codex용 stdio MCP 브리지 구현을 둔다.

## 코드 작성 컨벤션

- `createSdkMcpServer` + `tool` 조합을 사용한다.
- Codex 경로는 `@modelcontextprotocol/sdk` 기반 stdio 서버로 동일 도구를 노출한다.
- 입력 스키마는 `zod`로 정의하고, 반환은 `{ content: [...] }` 형태를 유지한다.
- Slack/GitHub 자격증명이 없을 때는 HITL 안내(에페메랄/버튼)를 보내고 `isError: true`로 반환한다.
- 동일 사용자에게 반복되는 HITL 안내는 일정 시간 내 중복 전송을 피한다.
