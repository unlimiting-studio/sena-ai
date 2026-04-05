---
name: sena-ai
description: "@sena-ai 프레임워크로 AI 에이전트를 만들거나 수정할 때 사용. 새 프로젝트 세팅, Slack 커넥터 연결(HTTP/Socket Mode), sena.config.ts 작성(runtime, hooks, schedules), 커스텀 도구 정의, MCP 서버 연결, CLI 운영을 안내한다."
---

# sena-ai Agent Framework

`@sena-ai`는 config-driven AI 에이전트 프레임워크다. `sena.config.ts` 하나로 런타임, 커넥터, 도구, 훅, 스케줄을 선언하고, CLI로 제로-다운타임 운영한다.

이 스킬은 세 파트로 나뉜다. 필요한 파트의 파일을 참조하라.

- **`project-setup.md`** - 새 프로젝트 초기화, Slack 커넥터 연결(HTTP/Socket Mode), .env 설정, CLI 명령어, 아키텍처, 트러블슈팅
- **`config-guide.md`** - sena.config.ts 필드 레퍼런스, env(), 런타임(permissionMode, allowedTools), 라이프사이클 훅(fileContext, traceLogger, 커스텀), 크론잡/하트비트 스케줄, TurnContext, 공통 패턴
- **`tools-and-mcp.md`** - defineTool로 인라인 도구 작성, slackTools 빌트인 도구, MCP 서버(HTTP/stdio) 연결, disabledTools 턴별 도구 제한, 커스텀 커넥터에서 도구 제어
