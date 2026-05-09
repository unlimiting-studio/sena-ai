# sena-ai v3

> ✅ **PoC 0단계 완료 (2026-05-10).** 미지수 8/8 닫힘 + 결정 #2/#3 ✅. 본 마이그 §1은 5/14 시작.
> 코드는 본 마이그부터 이 브랜치로 들어온다 (현재까지는 SPEC만).

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

## 다음 액션

본 마이그 §1 (5/14 시작): `~/agents/sena-poc/`를 베어본 에이전트로 승격. **첫 작업: chat-sdk 부수 발견 3건 wrapper** (`Thread.handleStream` 외부 reference 보호 / abort 시 stream stop swallow / `Chat.shutdown()` drain). 자세한 절차는 [`docs/specs/migration.md`](docs/specs/migration.md) §1.
