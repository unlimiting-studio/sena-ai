## 디렉토리 개요

Sena의 런타임 소스 코드 디렉토리다. Slack 이벤트 → Claude Agent SDK 실행 → Slack/GitHub/HITL 도구 제공 흐름을 포함한다.

## 파일 작성 컨벤션

- 기능별로 `agents/`, `routes/`, `mcp/`, `db/`, `sdks/`, `utils/`, `handlers/`로 분리한다.
- 라우팅은 `routes/*`에 두고 `server.ts`에서 prefix로 조립한다.
- 사용자-facing 에이전트 이름/기초 프롬프트는 `src/agentConfig.ts`에서 로드한다.

## 코드 작성 컨벤션

- TypeScript NodeNext + ESM
- 모든 로컬 임포트는 `.ts` 확장자를 포함한다.
- 타입 전용 임포트는 `type` 키워드를 사용한다.
- `any`, `as unknown` 사용 금지
- 외부 입력(Slack payload 등)은 `zod`로 검증한다.
