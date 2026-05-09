# sena-ai v3

> ✅ **PoC 0단계 완료 + @sena-ai/app 0.1.0 구현 진행 (2026-05-10).** 미지수 8/8 닫힘, Slack 운영형 에이전트 1차 실행 경로가 들어왔다.

- **PRD rev. 3:** <https://reports.yechanny.workers.dev/sena-v3-prd/>
- **PoC 0단계 보고서:** <https://reports.yechanny.workers.dev/sena-v3-poc-report/>
- **SPEC rev. 2 진입점:** [`SPEC.md`](SPEC.md)
- **분할 스펙:** [`docs/specs/`](docs/specs/)

## v3가 무엇인가

codex CLI와 Claude Code를 핵심 LLM 엔진으로 쓰는 에이전트 하네스를, **ai-sdk와 chat-sdk 위에 얇은 앱 레이어(스케줄 · channel context middleware · drain wrapper · steering 레이어 · MCP · multi-connector)만 얹어 다시** 만든다. v2 모노레포의 8개 자체 패키지(`@sena-ai/core`, `@sena-ai/connector-slack`, …)는 외부 라이브러리로 옮겨가고, 우리가 publish 책임지는 패키지는 **앱 자체 1개**(`@sena-ai/app`)로 줄어든다.

## 외부 의존 (확정 버전)

- [`ai@6.0.177`](https://ai-sdk.dev/) — LanguageModel 추상화 + middleware
- [`chat@4.28.1`](https://chat-sdk.dev/) + `@chat-adapter/slack@4.28.1` — 봇 트리거 / 출력
- `@chat-adapter/state-pg@4.28.1` — thread routing/concurrency 메타데이터 영속
- [`ai-sdk-provider-claude-code@3.4.4`](https://ai-sdk.dev/providers/community-providers/claude-code) — Claude Code CLI를 ai-sdk LanguageModel로 노출
- [`ai-sdk-provider-codex-cli@1.1.0`](https://ai-sdk.dev/providers/community-providers/codex-cli) — codex CLI를 ai-sdk LanguageModel로 노출

## 결정 상태 (rev. 2, 2026-05-10)

| # | 결정 | 상태 | 근거 |
|---|---|---|---|
| 1 | 분담 | ✅ | 세나 구현 / 브렌 검토 |
| 2 | chat-sdk state adapter | ✅ | `@chat-adapter/state-pg` 채택 (PoC 라이브 검증) |
| 3 | 프로세스 구조 | ✅ | 단일 프로세스 + 자체 drain wrapper + AbortController 기반 steering 레이어 (PoC 라이브 검증) |
| 4 | 앱 패키지명 | ✅ | `@sena-ai/app` |
| 5 | v2 history 보존 vs orphan reset | 보류 | 본 마이그 6/11 deprecation 시점 결정 |

## 실행 가능한 시작점

- 패키지: [`packages/app`](packages/app)
- 운영형 템플릿: [`templates/slack-agent`](templates/slack-agent)
- 현재 포함: Slack adapter helper, Postgres state helper, channel context middleware, trace middleware, cron fan-out, drain wrapper, steering 레이어
- 아직 fail-fast: `mcpServers` 실제 provider 연결. 설정에 넣으면 조용히 무시하지 않고 에러로 막는다.
