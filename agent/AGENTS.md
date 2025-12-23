# Sena

## Nested AGENTS.md
- 구조적 의미가 있는 폴더(예시: ./repositories, ./services, ./hooks, ./domain 등)에는 항상 AGENTS.md 파일을 생성해야함
- AGENTS.md에는 다음과 같은 내용을 반드시 기록할 것
  - 해당 폴더가 아키텍처 상 어떤 역할을 하는지
  - 해당 폴더를 구성하는 데에 적용 되는 파일 작성 컨벤션
  - 해당 폴더 하위의 폴더 및 파일들에 적용 되는 코드 작성 컨벤션

## 디렉토리 개요

Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`)를 중심으로 Karby의 Slack/GitHub 연동(HITL 포함)을 재구현한 실험용 서버 애플리케이션이다.

- Slack Events API/Interactivity 수신
- Slack OAuth(search:read) 연동 및 자격증명 저장
- GitHub OAuth 연동 및 자격증명 저장
- Claude Agent SDK `query` 기반 세션 실행/재개(resume)
- 커스텀 MCP 서버로 Slack/GitHub/HITL 도구를 제공

## 파일 작성 컨벤션

- `src/`: 런타임 소스 코드
- `src/server.ts`: Fastify 서버/라우팅
- `src/agents/`: Slack 이벤트를 Claude Agent SDK 실행으로 연결하는 에이전트 런타임
- `src/mcp/`: Claude Agent SDK에 주입할 커스텀 MCP 서버(tool) 정의
- `src/db/`: Slack/GitHub OAuth 토큰 저장(Drizzle + MySQL)과 암호화 유틸

## 코드 작성 컨벤션

- TypeScript NodeNext + ESM
- 모든 로컬 임포트는 `.ts` 확장자 포함
- 타입 전용 임포트는 `type` 키워드 사용
- `any`, `as unknown` 금지
- 동적 임포트보다 정적 임포트 우선

## 작업 후 필수 체크리스트
- `pnpm fix` 사소한 lint 오류 자동 정정 및 남은 lint 오류 파악
- `pnpm check:type`
- AGENTS.md 파일에 업데이트 되어야 하는 상태가 있으면 업데이트 할 것
- 해당 변경과 관련 된 **/AGENTS.md 파일에 변경이 필요하면 업데이트 할 것

## 라이브러리 사용
- 항상 context7의 도구를 사용하여 라이브러리의 최신 사용법을 정확히 숙지하고 사용 할 것
- 항상 pnpm을 사용하여 종속성을 설치 할 것 (npm/yarn 사용 금지)
- 패키지 설치 시 `package.json`을 직접 수정하지 않을 것. 항상 `pnpm add 패키지명`으로 설치할 것(최신 버전 우선)
- shadcn 컴포넌트 추가 시 `pnpm shadcn 컴포넌트명`으로 추가할 것

## 작섭상 주의/정책
- TypeScript에서 `any` 또는 `as unknown` 사용 금지(명시적 승인 없이). `as unknown as any` 역시 금지.
- 로컬 TS 파일 임포트 시 항상 `.ts` 확장자를 포함합니다(예: `import { foo } from "./bar.ts";`).
- 타입 임포트는 항상 `type` 키워드를 사용합니다(예: `import { type Foo, foo } from "./bar.ts";`).
- 동적 임포트보다 정적 임포트를 우선합니다.
- drizzle-orm/drizzle-kit 사용 시 마이그레이션 SQL 파일을 직접 생성하지 않습니다. 항상 `pnpm db:generate`로 생성합니다. (db:generate 스크립트 추가 필요)

## 작업 후 사용자 요청
- 작업 후 사용자가 세팅해야 하는 것(환경 변수 등), 혹은 확인해야 하는 것이 있다면 명시적으로 요구 할 것 (한국어로)

## 응답 절대 규칙
**반드시 한국어로 최종 응답을 할 것**