# sena-ai v3 — SPEC

**상태:** Draft (2026-05-10)
**PRD:** <https://reports.yechanny.workers.dev/sena-v3-prd/> (rev. 2)

이 문서는 v3 구현이 따라야 할 **컴포넌트별 분할 스펙의 진입점**이다. PRD가 *무엇을 / 왜* 라면, 이 SPEC 트리는 *어떻게 / 어디에서* 다.

PRD는 `Risk Matrix`와 `후속 의사결정 포인트`에서 **검증 필요 영역**과 **차니 결정 대기 항목**을 명시했다. SPEC도 같은 톤으로 — 정해진 것은 정해졌다고, 미지수는 미지수라고 — 분리해서 적는다. 1차 마이그(PoC 에이전트 1개)에서 미지수 영역이 차차 닫혀가면 그 시점에 SPEC도 rev. 2로 올린다.

## 모듈 매핑

| 영역                              | 분할 스펙                                  | 한 줄                                                                          |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| 아키텍처 (레이어 / 데이터 흐름)   | [`docs/specs/architecture.md`](docs/specs/architecture.md) | 트리거 → 어댑터 → 우리 미들웨어 → ai-sdk LanguageModel → provider → 엔진      |
| `sena.config.ts` 인터페이스       | [`docs/specs/config.md`](docs/specs/config.md)             | `defineConfig({ model, adapters, middlewares, schedules, state, mcpServers })` |
| hook 합성                          | [`docs/specs/hooks.md`](docs/specs/hooks.md)               | ai-sdk `LanguageModelV3Middleware` (`transformParams` / `wrap*`) 위에 다시 짠다 |
| 스케줄                             | [`docs/specs/schedules.md`](docs/specs/schedules.md)       | `cronSchedule(cron, prompt, target)`. chat-sdk `ScheduledMessage` 흡수 가능성 검증 |
| channel context                    | [`docs/specs/channels.md`](docs/specs/channels.md)         | `channels.json` + per-channel `memory.md`를 한 턴 system prompt에 합성        |
| Slack connector                    | [`docs/specs/connectors/slack.md`](docs/specs/connectors/slack.md) | `chat` + `@chat-adapter/slack` 채택. 출력 디테일은 어댑터 그대로 따름          |
| LLM runtime                        | [`docs/specs/runtimes.md`](docs/specs/runtimes.md)         | `ai-sdk-provider-claude-code` / `-codex-cli`. 모델·reasoning은 시스템 cc/codex 위임 |
| MCP & inline tool                  | [`docs/specs/tools.md`](docs/specs/tools.md)               | MCP 서버 1급. Zod inline tool은 chat-sdk·ai-sdk 메커니즘 흡수 시도 → 안 되면 MCP 우회 |
| 마이그레이션                       | [`docs/specs/migration.md`](docs/specs/migration.md)       | sena_v2 PoC → 본 sena → 브렌 → lumie → sooki                                  |

## 검증 필요 영역 (PRD §9 Risk 그대로)

이 항목들은 **1차 마이그 직후 전수조사 1회**로 닫는다. 그 전까지는 가설 / 미지수로 표시.

- ai-sdk `LanguageModelV3Middleware` 위에 우리 hook 의도가 어디까지 매핑되는가
- chat-sdk 핸들러 hook 가능 지점 (message · reaction · button · slash · modal 단위)
- chat-sdk `ScheduledMessage`가 `cronSchedule`을 흡수하는지
- `@chat-adapter/slack`의 디테일 커버 범위 (mrkdwn · streaming · unfurl · table · archive permalink labeling)
- Zod inline tool이 chat-sdk · ai-sdk 자체 메커니즘으로 흡수되는지 (claude-code provider가 AI SDK Zod tool 미지원이라는 점 고려)
- chat-sdk 자체 observability 범위 (`traceLogger`를 어느 레이어에 둘지)

## 차니 결정 대기 (PRD §11)

**스펙을 닫기 전에 결정이 필요한 항목.** 마이그 1차에 한 항목이라도 빠져 있으면 그 영역의 분할 스펙도 미완으로 남는다.

1. **분담** — 세나(마이그 순서·잃는 항목·고유 인프라 매핑) / 브렌(provider 코드 + Slack 어댑터 직접 검증).
2. **chat-sdk state adapter 선택** — `state-memory` / `state-pg` / `state-redis` / `state-ioredis`. → `docs/specs/connectors/slack.md` §State 섹션 결정 차단.
3. **프로세스 구조** — v2 orchestrator-worker 분리 유지 / 단일 프로세스 / 더 좋은 방안.
4. **앱 자체 패키지명** — `@unlimiting-studio/sena` / `@sena-ai/sena` / 다른 안. → `package.json` placeholder 차단.
5. **v2 모노레포 history 보존 vs orphan branch 완전 reset** — 이 브랜치(`v3`)를 main으로 force push할지 별도 라인으로 둘지.

## 작성 원칙

- **정해진 것은 절대형으로, 미지수는 미지수형으로.** "검증 후 결정", "차니 결정 대기" 같은 표현을 그대로 쓴다. 가설을 절대형으로 위장하지 않는다.
- **chat-sdk · ai-sdk가 책임지는 영역은 우리가 다시 정의하지 않는다.** Slack 출력 디테일·session 영속성·trigger 분기 등은 라이브러리 동작을 따른다고만 적는다.
- **시그니처는 1차 가설로 적되 변경 가능을 명시한다.** v2 hook 함수 시그니처를 그대로 가져갈 수 없으므로, 마이그 중 결정한다고 못박는다.
- **AC(수용 기준)는 분할 스펙 끝에 1~3개씩 둔다.** 1차 마이그가 끝났을 때 검증 가능한 형태로.
