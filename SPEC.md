# sena-ai v3 — SPEC

**상태:** rev. 2 (2026-05-10, PoC 0단계 검증 결과 반영)
**PRD:** <https://reports.yechanny.workers.dev/sena-v3-prd/>
**PoC 보고서:** <https://reports.yechanny.workers.dev/sena-v3-poc-report/>

이 문서는 v3 구현이 따라야 할 **컴포넌트별 분할 스펙의 진입점**이다. PRD가 *무엇을 / 왜* 라면, 이 SPEC 트리는 *어떻게 / 어디에서* 다.

rev. 2는 PoC 0단계 라이브 검증 결과로 미지수 8건을 닫고, 확정 결정 #2 / #3을 채택한 상태다.

## 모듈 매핑

| 영역                              | 분할 스펙                                  | 한 줄                                                                          |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| 아키텍처 (레이어 / 데이터 흐름)   | [`docs/specs/architecture.md`](docs/specs/architecture.md) | 트리거 → 어댑터 → 우리 미들웨어 → ai-sdk LanguageModel → provider → 엔진      |
| `sena.config.ts` 인터페이스       | [`docs/specs/config.md`](docs/specs/config.md)             | `defineConfig({ model, adapters, middlewares, schedules, state, mcpServers })` |
| hook 합성                          | [`docs/specs/hooks.md`](docs/specs/hooks.md)               | ai-sdk `LanguageModelV3Middleware` (`transformParams` / `wrap*`) 위에 다시 짠다 |
| 스케줄                             | [`docs/specs/schedules.md`](docs/specs/schedules.md)       | `cronSchedule(cron, prompt, target)`. chat-sdk `ScheduledMessage`는 미래 발송 1-shot이라 별개 — 우리 패턴(외부 cron + `chat.thread()` reference + `thread.post(string)`)으로 직접 짠다 |
| channel context                    | [`docs/specs/channels.md`](docs/specs/channels.md)         | `channels.json` + per-channel `memory.md`를 한 턴 system prompt에 합성        |
| Slack connector                    | [`docs/specs/connectors/slack.md`](docs/specs/connectors/slack.md) | `chat` + `@chat-adapter/slack`. 출력 디테일은 어댑터 native. multi-socket coexist로 zero-downtime 가능 |
| LLM runtime                        | [`docs/specs/runtimes.md`](docs/specs/runtimes.md)         | `ai-sdk-provider-claude-code` / `-codex-cli`. 모델·reasoning은 시스템 cc/codex 위임 |
| MCP & inline tool                  | [`docs/specs/tools.md`](docs/specs/tools.md)               | MCP 서버 1급. Zod inline tool은 provider 미지원이라 inline MCP 우회 (확정) |
| 마이그레이션                       | [`docs/specs/migration.md`](docs/specs/migration.md)       | sena_v2 또는 신규 PoC → 본 sena → 브렌 → lumie → sooki                         |

## 확정된 결정

| # | 결정 | 상태 | 근거 |
|---|---|---|---|
| 1 | **분담** | ✅ 확정 (2026-05-10) | 세나가 구현, 브렌이 검토 |
| 2 | **chat-sdk state adapter** | ✅ **`@chat-adapter/state-pg` 채택** (2026-05-10, PoC 검증) | 라이브에서 subscribe 영속 + 재시작 후 `onSubscribedMessage` 라우팅 검증. codex/claude-code 자체 state(모델 conversation)와 역할이 다른 thread routing/concurrency 메타데이터 보관. v2 `wasBotMentionedInThread()` 우회를 native 해결 |
| 3 | **프로세스 구조** | ✅ **단일 프로세스 + 자체 drain wrapper + AbortController 기반 steering 레이어** (2026-05-10, PoC 검증) | 단일 Node 프로세스로 hot-reload / 다중 connector / cron 발화 모두 동작. chat-sdk shutdown drain 부재는 우리 `inFlight` 카운터 + drain 루프로 메움. multi-socket coexist로 zero-downtime rolling restart 가능 |
| 4 | **앱 자체 패키지명** | ✅ 확정 (2026-05-10) | `@sena-ai/app` |
| 5 | v2 모노레포 history 보존 vs orphan branch reset | 보류 | 본 마이그 6/11 deprecation 시점에 결정 |

## PoC 0단계 — 미지수 닫힘 (8/8)

라이브 검증 결과 전체는 **PoC 보고서**(<https://reports.yechanny.workers.dev/sena-v3-poc-report/>) 참조. 요약:

| # | 미지수 | 결과 |
|---|---|---|
| 1 | ai-sdk `LanguageModelV3Middleware` hook 가능 지점 | ✅ `transformParams` + `wrapStream` 모두 동작. 모든 chunk type(`stream-start / response-metadata / reasoning-* / tool-input-* / tool-call / tool-result / text-* / finish`) 노출 |
| 2 | chat-sdk 핸들러 hook 가능 지점 | ✅ `onNewMention` / `onSubscribedMessage` 라이브 트리거 |
| 3 | `ScheduledMessage`가 `cronSchedule` 흡수 | ❌ 다른 개념. `ScheduledMessage`는 미래 발송 1-shot. cronSchedule은 우리가 직접 짠다(외부 setTimeout/node-cron + `chat.thread()` 외부 reference + `thread.post(string)`) |
| 4 | `@chat-adapter/slack` 출력 디테일 | ✅ `markdown_text` native + streaming + mrkdwn 자동 처리 (lily 라이브 사용에서 확인) |
| 5 | Zod inline tool 흡수 | ❌ provider 미지원. **MCP 우회 확정** |
| 6 | chat-sdk observability 범위 | ✅ ai-sdk `wrapStream` middleware로 충분. chat-sdk 자체 trace API 별도 의존 불필요 |
| 7 | `@chat-adapter/state-pg` 실 동작 | ✅ subscribe → 재시작 → 멘션 없는 follow-up이 `onSubscribedMessage`로 라우팅 |
| 8 | 프로세스 구조 입력 | ✅ 단일 프로세스 + drain wrapper + steering 레이어 패턴 검증 |

## 부수 발견 (chat-sdk 4.28.1 / @chat-adapter/slack 4.28.1)

본 마이그 시 wrapper 패치 또는 upstream PR 후보:

1. **`Thread.handleStream` 외부 reference에서 깨짐** — `chat/dist/index.js:1631` `_currentMessage.author.userId` dereference. `chat.thread(id)`로 만든 외부 reference에서 stream post 시 `Cannot read properties of undefined`. cron 발화처럼 incoming message 없는 시나리오에서 streaming 출력 불가 (PoC는 `await result.text` 후 string post로 우회).
2. **abort 시 `chatStream.stop()`이 `not_authed` 던짐** — `@chat-adapter/slack/dist/index.js:3386`. 새 turn에는 영향 없지만 abort된 stream 클로즈 처리가 깨끗하지 않음.
3. **`Chat.shutdown()` in-flight handler drain 부재** — `chat/dist/index.js:2454-2476`. 어댑터/state disconnect만 하고 핸들러 추적 안 함. 우리 `inFlight` + drain 루프 wrapper로 메움.

## 작성 원칙

- **정해진 것은 절대형으로, 미지수는 미지수형으로.** 절대형으로 위장하지 않는다.
- **chat-sdk · ai-sdk가 책임지는 영역은 우리가 다시 정의하지 않는다.** Slack 출력 디테일·session 영속성·trigger 분기 등은 라이브러리 동작을 따른다고만 적는다.
- **시그니처는 1차 가설로 적되 변경 가능을 명시한다.** v2 hook 함수 시그니처를 그대로 가져갈 수 없으므로, 마이그 중 결정한다고 못박는다.
- **AC(수용 기준)는 분할 스펙 끝에 1~3개씩 둔다.** 1차 마이그가 끝났을 때 검증 가능한 형태로.
