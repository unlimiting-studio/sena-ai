# Migration

**상태:** rev. 3 (§1 step 1 ~ 4.7 진척 + 부수 발견 #4 (5/10 streamText unhandled rejection) + #5 (lily subscription leak) 등재).

## 한 줄

**0. PoC 0단계 (조합 검증)** → 1~8. 본 에이전트 순차 마이그(sena_v2 또는 신규 PoC → 본 sena → 브렌 → lumie → sooki).

## 0. PoC 0단계 — 조합 검증 ✅ 완료 (2026-05-10)

차니 시그널: *"ai-sdk + chat-sdk + codex / claude-code adapter 이 조합에서 어떻게 작동할지 보고 생각해줘"* (2026-05-10).

본 마이그(§1~8) 진입 전에 **단일 베어본 에이전트**로 SPEC §"확정된 결정"의 미지수를 한 번에 닫는다.

### 0단계 범위 (완료)

- ✅ `~/agents/sena-poc/` 디렉토리 생성, `@sena-ai/app` 자리만 잡고 PoC 코드 직접 작성
- ✅ 의존: `ai@6.0.177`, `chat@4.28.1`, `@chat-adapter/slack@4.28.1`, `@chat-adapter/state-memory@4.28.1`, `@chat-adapter/state-pg@4.28.1`, `ai-sdk-provider-claude-code@3.4.4`, `ai-sdk-provider-codex-cli@1.1.0`
- ✅ Slack 봇 `lily` (`U0APLTFB3E0`) socket mode + `#project-sena` 채널에서 라이브 검증

### 0단계 미지수 — 결과 (8/8 닫힘)

| 미지수 | 결과 | 검증 방법 |
|---|---|---|
| ai-sdk `LanguageModelV3Middleware` hook 가능 지점 | ✅ | `transformParams` + `wrapStream`에 `traceLogger` 박고 chunk 분포 관찰. 한 turn에 8 tool call까지 trace 잡힘 |
| chat-sdk 핸들러 hook 가능 지점 | ✅ | `onNewMention` → `subscribe()` → `onSubscribedMessage` 정상 라우팅 |
| `ScheduledMessage`가 `cronSchedule` 흡수 | ❌ 다른 개념 | `ScheduledMessage` = 미래 발송 1-shot. cronSchedule은 우리 패턴(외부 setTimeout + `chat.thread(id)` reference + `thread.post(string)`)으로 직접 짠다 |
| `@chat-adapter/slack` 출력 디테일 | ✅ | `markdown_text` native·streaming·mrkdwn 자동 처리 lily 사용에서 확인 |
| Zod inline tool 흡수 | ❌ provider 미지원 | inline MCP 우회 확정 |
| chat-sdk observability 범위 | ✅ | ai-sdk `wrapStream` middleware로 충분 |
| `@chat-adapter/state-pg` 실 동작 | ✅ | Docker PG → `createPostgresState` → 5 테이블 자동 생성 → `subscribe()` 영속 → 재시작 → 멘션 없는 follow-up이 `onSubscribedMessage`로 라우팅 |
| 프로세스 구조 입력 | ✅ | 단일 프로세스 + drain wrapper(`inFlight` 카운터 + 60s drain 루프) + AbortController 기반 steering 레이어. multi-socket coexist로 zero-downtime 가능 |

### 0단계 결과물

- ✅ **PoC 코드** — `~/agents/sena-poc/` (모드 토글: `SENA_POC_STEER_MODE` / `DATABASE_URL` / `SENA_POC_CRON_TARGET`)
- ✅ **PoC 보고서** — <https://reports.yechanny.workers.dev/sena-v3-poc-report/>
- ✅ **SPEC rev. 2** — 이 문서 + `SPEC.md` + 분할 스펙 6개 갱신 완료
- ✅ **확정 결정 #2 채택** — `@chat-adapter/state-pg`
- ✅ **확정 결정 #3 채택** — 단일 프로세스 + drain wrapper + steering 레이어

### 부수 발견 (본 마이그 시 wrapper / upstream PR)

#1~3 은 chat-sdk 4.28.1 / @chat-adapter/slack 4.28.1 PoC 단계 발견. 본 마이그 §1에서 첫 작업으로 wrapper 또는 upstream 이슈 등록.

#4~5 는 본 마이그 §1 step 3 ~ 4.7 라이브 운영 단계 발견.

1. `Thread.handleStream` 외부 reference에서 깨짐 (`chat/dist/index.js:1631`) — PoC.
2. abort 시 `chatStream.stop()`이 `not_authed` 던짐 (`@chat-adapter/slack/dist/index.js:3386`) — PoC.
3. `Chat.shutdown()` in-flight handler drain 부재 (`chat/dist/index.js:2454-2476`) — PoC.
4. **ai-sdk `streamText` background PromiseLike unhandled rejection** — step 4.7 (`f028ef7`, 5/10 라이브 회귀 fix). steering 시 `prev.controller.abort()` 호출 후 ai-sdk `streamText` 의 `text`/`usage`/`finishReason`/... 14개 background promise 가 한꺼번에 reject 되는데 핸들러가 일부만 await 한 경우 나머지는 unhandled — Node `--unhandled-rejections=throw` default 에서 process kill. **증상:** 5/10 05:35 sena-bare 가 두 번째 멘션(steering interrupt) 시점에 unhandled `DOMException [AbortError]` 로 process exit. **봉합:** `silenceStreamTextRejections(result)` (`runtime/handlers/utils.ts`) 가 14개 known field 에 noop `.catch()` 핸들러를 미리 부착 → Node 가 더 이상 unhandled 로 카운트하지 않음. handler 가 명시적으로 await 하면 같은 reject 가 거기서도 흐르므로 동작은 동등. steering / step-steering / schedules 모두 동일 패턴 적용. **운영 안전망:** `runtime/run.ts` 의 `process.on('unhandledRejection', ...)` listener 도 같이 박혀 있어 신규 필드가 추가돼도 process kill 안 됨. **진짜 root fix** 는 ai-sdk / chat-sdk 내부 (background promise 의 reject 가 user-await 안 됐을 때 silently 흡수) — step 5+.
5. **lily subscription leak (운영 격리)** — step 4.7 라이브 운영에서 발견. *코드 수정 없이 state-pg 수동 DELETE 로 격리.* **증상:** 일반 mention 핸들러(`chat.onNewMention`) 가 자동으로 `thread.subscribe()` 를 호출하는 구조 + 활발한 작업 thread → 봇이 그 thread 의 *모든 후속 메시지* 를 흡수 → 봇끼리 / 사람끼리 주고받는 잡담까지 `onSubscribedMessage` 라우팅 → `inFlight` 카운터 폭주 + 응답 지연. **봉합:** `chat_state_subscriptions` 테이블에서 해당 lily-thread 행을 수동 DELETE 로 격리 (영속 subscribe 해제). **진짜 fix** 는 step 5+:
   - `triggers.filter(event)` 정식 구현 (Slack connector 4/4 spec) — channelId / userId / text / threadTs 등 기준 무시 가능.
   - 자동 unsubscribe 도구 (turn 내 명시 호출 또는 idle TTL).
   - 핸들러를 *opt-in subscribe* 로 디자인 변경 (현재는 opt-out 도 어려운 자동 subscribe 디자인).

## §1 step 별 진척 (본 마이그 1번 시작 — 코드 commit 단위)

본 마이그 §1 의 *1번 (베어본 + 신규 PoC 에이전트)* 은 PoC 0단계 직후 step 1~4.7 의 7 commit 으로 진행 중. 본 표는 step 단위 commit 과 결과를 추적한다 (스펙 ↔ 코드 정합성 트래킹용).

| step | commit | 내용 | 결과 |
|---|---|---|---|
| 1 | `f8afbe4` | monorepo 골격 + `@sena-ai/app` skeleton | pnpm workspace + tsconfig + package.json + skeleton export. 코드 동작 없음. |
| 2 | `ede03b1` | chat-sdk 부수 발견 3건 wrapper + traceLogger 이전 | PoC 발견 #1~3 wrapper 패키지로 추출. v2 `traceLogger` ai-sdk middleware 로 다시 짬. |
| 3 | `8c916cf` | `run()` 통합 entry + 3종 핸들러 + codex 11 라운드 | `runtime/run.ts` 가 mention/onSubscribedMessage/reaction 3종 핸들러를 등록. drain wrapper + steering 레이어 + AbortController 기반 인터럽트. codex 11 라운드 review. |
| 4 | `53649b7` | schedules fan-out + ScheduleTarget 좁힘 + codex 6 라운드 | `runtime/scheduleFanOut.ts` 신설. `ScheduleTarget` union 에서 `conversation` 제거 (step 5+ 로 미룸). `node-cron` + `noOverlap` + KST + drain.track + rollback. codex 6 라운드 review. |
| 4.5 | `fe91d92` | history-aware 시도 후 롤백 결정 기록 | 차니 우려 (state 호환성) 받아 history-aware 모드를 잠깐 시도했지만 두 회귀 (채널 잡담 섞임 / thread assistant-only 비대칭) → 롤백. *prompt-only 직행* 으로 정정. 결정만 기록 (코드는 step 4 상태 유지). |
| 4.6 | `cbc0208` (차니 직접) | starter runnable + factory wrapper + channelContext 확장 + tools/maxSteps | `templates/slack-agent/` starter 가 실제로 부팅 되도록 factory wrapper (`slackAdapter`, `postgresState`, `requiredEnv`, `createMemoryState`) 추가. `channelContext.optional` 추가. `streamText({ tools, stopWhen: stepCountIs(maxSteps) })` 를 모든 핸들러 + schedule 에 적용. |
| 4.7 | `f028ef7` | `silenceStreamTextRejections` — 5/10 라이브 unhandled rejection 회귀 fix | 부수 발견 #4 봉합. 14개 background promise 필드에 noop catch + `process.on('unhandledRejection', ...)` 운영 안전망. handler / schedule 진입 후 첫 줄에 호출. |

### 라이브 운영 상태 (rev. 3 작성 시점)

- **sena-bare** (step 4.7 빌드, lily 봇 `U0APLTFB3E0` socket mode) — PID 59351 실행 중, `#project-sena` 라이브.
- **state-pg** Docker — 5 테이블 (`chat_messages`, `chat_state_subscriptions`, `chat_state_kv`, `chat_state_dedup`, `chat_state_outbox`) 정상.
- **테스트** — `@sena-ai/app` 26 tests passing (drain / schedule fan-out / handlers / utils / turn-context).
- **부수 발견 #5 격리** — `chat_state_subscriptions` 에서 lily 의 leaked subscription 행 수동 DELETE 로 inFlight 폭주 차단. step 5+ 에서 `triggers.filter` / opt-in subscribe / 자동 unsubscribe 도구로 정식 fix.

## 마이그 단위 절차

각 에이전트 1개당:

1. **새 디렉토리 준비** — 기존 `~/agents/{name}/` 옆에 `~/agents/{name}-v3/` 또는 별도 브랜치. 1차에서는 두 버전이 공존할 수 있게 두고, 안정화 후 swap.
2. **`sena.config.ts` v3 인터페이스로 다시 작성** — `docs/specs/config.md` §"1차 가설" 그대로. 기존 v2 설정의 의도를 한 항목씩 매핑.
3. **hook 코드 마이그** — v2의 `TurnStartHook` / `TurnEndCallback` / 사용자 `reviewGate` 등을 ai-sdk middleware로 다시 짠다 (`docs/specs/hooks.md` §"v2 hook → v3 middleware 매핑").
4. **`.sessions.json` 폐기** — chat-sdk state adapter로 교체 (`docs/specs/connectors/slack.md` §State).
5. **MCP / inline tool 정리** — `defineTool()` 코드는 inline MCP 서버 또는 chat-sdk·ai-sdk 흡수 경로로 (`docs/specs/tools.md`).
6. **24시간 라이브 운영** — 멘션 / 스레드 / cron / reaction abort / 채널 컨텍스트 합성을 모두 한 번 이상 통과시켜 회귀 항목 점검.
7. **회귀 항목 패치** — Slack 디테일 미커버 발견 시 wrapper 또는 upstream PR. 자체 코드 수정은 *마지막 수단*.
8. **v2 의존성 제거** — `@sena-ai/*` 의존을 모두 떼고, 기존 `~/agents/{name}/`의 v2 프로세스 중지.

## v2 hook → v3 middleware 매핑 (체크리스트)

| v2 코드 위치                          | v3 옮길 곳                                  | 비고                                                         |
| ------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `hooks/channelContext.ts`             | `middlewares: [channelContext()]`           | `transformParams`에서 system 합성. `docs/specs/channels.md`. |
| `hooks/sunnySystemHook.ts`            | (v3 1차 범위 외)                           | Sunny adapter는 v3 1차에서 빼기로. PRD §7.                   |
| `hooks/traceLogger.ts`                | `middlewares: [traceLogger()]`              | `wrapStream`에서 chunk 단위 관찰.                            |
| `hooks/reviewGate.ts` (브렌)          | middleware로 다시 짬                        | 시그니처 변경 가능. PoC에서 형태 결정.                       |
| `cronSchedule()` / `heartbeat()`      | `schedules: [cronSchedule({...})]`          | `heartbeat`는 별도 API 폐기, cron으로 통합. `docs/specs/schedules.md`. |
| `defineTool()` (Zod 인라인 도구)      | inline MCP 서버 우회 또는 chat-sdk·ai-sdk 자체 메커니즘 | `docs/specs/tools.md`.                                       |
| `restart_agent` (worker 내부 도구)    | 프로세스 구조 결정에 의존                    | 차니 §11.3 결정 후 별도 다룸.                               |

## 잃는 것 (PRD §9 + PoC 발견)

- claude-code provider Zod tool 미지원 → MCP 우회. (확정)
- claude-code provider reasoningEffort 미지원 → cc 시스템 설정 위임 (옵션이 noop).
- codex-cli provider 모델명 사전 정의 → 신규 모델은 provider upstream PR.
- chat-sdk Slack 어댑터 디테일 커버 범위 미지 → 마이그 1차 직후 전수조사.
- **chat-sdk `Thread.handleStream` 외부 reference 미지원** (PoC 발견 #1) → cron 발화에서 streaming 출력 불가. wrapper 또는 upstream PR.
- **chat-sdk abort 시 stream stop이 `not_authed`** (PoC 발견 #2) → wrapper로 무시.
- **chat-sdk `Chat.shutdown()` drain 부재** (PoC 발견 #3) → 우리 `inFlight` + drain 루프 wrapper로 메움.

## 일정 (PRD §10 + 0단계 결과 반영)

- ✅ **5/10** SPEC rev. 1 (확정 결정 4개 반영) — 완료.
- ✅ **5/10** **0단계 PoC** (위 §0) — **완료** (당일 라이브 검증). SPEC rev. 2 발행.
- **5/14 ~ 5/20** 베어본 + sena_v2 또는 신규 PoC 에이전트 1개 본 마이그. **첫 작업: 부수 발견 3건 wrapper.**
- **5/21 ~ 5/27** Slack 디테일 전수조사 + 미커버 항목 패치.
- **5/28 ~ 6/10** 본 에이전트 순차 마이그 (sena → 브렌 → lumie → sooki).
- **6/11 ~ 6/24** v2 deprecation, 6주 측정 시작.

## v2 deprecation

4 에이전트 모두 v3 위에서 24h 안정화한 다음:
- v2 프로세스(`sena restart` SIGUSR2 기반) 영구 중단.
- `@sena-ai/*` 패키지의 npm `latest` 태그 freeze (deprecate 메시지 추가).
- v2 `Variel/sena` 리포는 archive 표시.
- 모노레포 history 보존 / orphan reset 결정은 차니 §11.5 확정 후.

## AC

1. 1차 PoC 에이전트가 24시간 라이브 운영 중 v2 동등 기능을 100% 통과한다 (멘션 응답 / streaming / unfurl / reaction abort / cron / channel context).
2. 4 에이전트 마이그 후 6주 동안 #project-sena 채널의 디버그 항목이 v2 직전 6주 대비 절반 이하 (PRD `S-2`).
3. 외부 빌더 1명이 v3 README와 PoC 디렉토리만 보고 새 에이전트를 띄울 수 있다 (PRD `S-4`).
