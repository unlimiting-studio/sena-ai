# sena-ai v3

> ⚠️ **Spec phase.** 이 브랜치는 sena-ai v3의 orphan branch이고, 현재는 SPEC만 들어 있다. 코드는 1차 마이그 시점부터 들어온다.

- **PRD:** <https://reports.yechanny.workers.dev/sena-v3-prd/>
- **SPEC 진입점:** [`SPEC.md`](SPEC.md)
- **분할 스펙:** [`docs/specs/`](docs/specs/)

## v3가 무엇인가

codex CLI와 Claude Code를 핵심 LLM 엔진으로 쓰는 에이전트 하네스를, **ai-sdk와 chat-sdk 위에 운영 보조 인프라(스케줄 · hook · channel context · MCP · multi-connector)만 얹어 다시** 만든다. v2 모노레포의 8개 자체 패키지(`@sena-ai/core`, `@sena-ai/connector-slack`, …)는 외부 라이브러리로 옮겨가고, 우리가 publish 책임지는 패키지는 **앱 자체 1개**로 줄어든다.

## 외부 의존 (확정)

- [`ai`](https://ai-sdk.dev/) — LanguageModel 추상화 + middleware
- [`chat`](https://chat-sdk.dev/) + `@chat-adapter/slack` — 봇 트리거 / 출력 / 세션 영속성
- [`ai-sdk-provider-claude-code`](https://ai-sdk.dev/providers/community-providers/claude-code) — Claude Code CLI를 ai-sdk LanguageModel로 노출
- [`ai-sdk-provider-codex-cli`](https://ai-sdk.dev/providers/community-providers/codex-cli) — codex CLI를 ai-sdk LanguageModel로 노출

## 결정 상태 (2026-05-10)

차니 결정으로 4개 닫힘. v2 history 보존 1개는 본 마이그 종반에.

- **분담** ✅ 세나 구현 / 브렌 검토
- **chat-sdk state adapter** ✅ `@chat-adapter/state-pg` (PoC 0단계에서 검증)
- **프로세스 구조** ⏸ PoC 0단계 결과 후 결정
- **앱 패키지명** ✅ `@sena-ai/app`
- **v2 history 보존 vs orphan reset** ⏸ 본 마이그 6/11 deprecation 시점

## 다음 액션

`SPEC.md` §"PoC 0단계"가 본 마이그 진입 전 핵심 검증 단계다. `docs/specs/migration.md` §0이 0단계 체크리스트와 결과물(`reports.yechanny.workers.dev/sena-v3-poc-report/` 예정)을 정의한다.
