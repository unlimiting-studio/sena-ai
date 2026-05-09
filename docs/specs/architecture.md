# Architecture

**상태:** rev. 2 (PoC 0단계 검증 결과 반영).

## 한 줄

트리거(Slack · cron) → chat-sdk 어댑터 → 우리 미들웨어(channel context · system 합성 · trace) → ai-sdk LanguageModel → provider(claude-code / codex-cli) → 엔진(Claude Code CLI / codex CLI). **단일 Node 프로세스 + 자체 drain wrapper + AbortController 기반 steering 레이어** (확정 결정 #3).

## 레이어

| 레이어               | 책임                                                                            | 누가 짠 것                  |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| 트리거               | Slack 이벤트 수신 / cron 발화 / 외부 시스템 입구                                | chat-sdk + cron(node-cron 또는 chat-sdk `ScheduledMessage`) |
| 어댑터               | mention · thread · reaction · button · slash · modal 라우팅, 출력(streaming · mrkdwn · unfurl · table) | `@chat-adapter/slack`         |
| **우리 미들웨어**     | per-channel context 합성 · system prompt 합성 · turn trace                       | sena-ai v3 자체 코드 (얇음)   |
| LanguageModel 추상화 | `streamText` / `generateText` / `wrapLanguageModel`                             | `ai`                          |
| provider              | LanguageModel → Claude Code CLI / codex CLI 변환                                | `ai-sdk-provider-claude-code` / `-codex-cli` |
| 엔진                  | 실제 LLM·tool call 실행                                                         | Claude Code CLI / codex CLI   |

> **우리가 직접 짜는 코드는 "얇은 앱 레이어"** — ai-sdk middleware(channel context · system compose · trace) + 자체 schedules + drain wrapper + AbortController 기반 steering 레이어 + 인라인 MCP 서버. 그 외(어댑터 / LanguageModel 추상 / provider / 엔진)는 외부 라이브러리에 위임.

## 프로세스 구조 (확정 결정 #3)

**단일 Node 프로세스** 안에 다음 레이어가 같이 있다:

1. **chat-sdk Chat 인스턴스** — 어댑터·state·핸들러 등록.
2. **우리 drain wrapper** — `inFlight` 카운터를 핸들러 진입/탈출 시 증감. SIGTERM 받으면 `draining=true` 플래그 + `inFlight=0` 될 때까지 200ms 폴링 (60s timeout) 후에 `chat.shutdown() + process.exit`.
3. **우리 steering 레이어** — `chat-sdk concurrency: "concurrent"`로 thread lock 우회 + thread별 `Map<threadKey, { controller: AbortController, partialText }>` 관리. 새 메시지 도착 시 기존 controller `.abort()` → ai-sdk `streamText({ abortSignal })`로 전파 → 같은 핸들러 내부 loop가 새 컨텍스트로 다음 turn 재시작.
4. **ai-sdk middleware 체인** — `wrapLanguageModel({ model, middleware: [channelContext, systemCompose, traceLogger] })`.
5. **provider** — `claudeCode()` 또는 `codexCli()`가 LanguageModel 호출 받고 CLI subprocess spawn.

### Zero-downtime rolling restart

같은 xapp 토큰으로 두 인스턴스가 동시에 socket connect 가능 (Slack 공식 멀티 소켓 분산 라우팅). 따라서 SIGUSR2 기반 v2 패턴 대신:

1. 새 인스턴스 띄움 → socket connect (Slack이 새 이벤트를 양쪽에 분산)
2. 기존 인스턴스 SIGTERM → drain wrapper가 inFlight=0 될 때까지 대기
3. 기존 인스턴스 자연 exit

→ in-flight turn은 끝까지 처리되고 새 인스턴스가 새 이벤트를 받는다.

## 데이터 흐름 (한 turn)

1. **트리거 도착** — Slack `app_mention` / `message` / `reaction_added` 또는 cron 발화.
2. **chat-sdk handler 진입** — Slack adapter가 trigger를 chat-sdk Conversation/Thread/Message 객체로 변환. cron 트리거도 동일한 입구로 합류한다(메시지 형태로 conversation에 주입).
3. **우리 미들웨어 1차 — channel context 합성** — `conversation.id`(Slack channel ID)에서 `channels.json` 항목 + per-channel `memory.md` 조회 → system prompt 후보에 추가.
4. **chat-sdk → ai-sdk 변환** — `toAiMessages`(또는 동등한 API)로 chat-sdk Message history를 ai-sdk LanguageModel 입력으로 변환.
5. **ai-sdk middleware 적용** — `wrapLanguageModel({ model, middleware: [systemCompose, traceLogger] })`. `transformParams`에서 system prompt를 prepend, `wrapStream`에서 chunk·tool call 관찰.
6. **provider 호출** — `claudeCode()` 또는 `codexCli()` provider가 LanguageModel 인터페이스로 호출 받고 내부적으로 CLI를 spawn하여 turn 진행.
7. **chat-sdk가 출력 처리** — streaming preview, 최종 메시지(unfurl · table · mrkdwn)는 `@chat-adapter/slack`이 책임.

## 그림

> PRD §"시각화 — 아키텍처 레이어" 다이어그램과 동일한 구조 ([HTML view](https://reports.yechanny.workers.dev/sena-v3-prd/#architecture)). 여기서는 텍스트 요약만 둔다.

## 검증 결과 (rev. 2)

- ✅ chat-sdk는 자체 system prompt 합성 hook을 노출하지 않음. 우리 미들웨어(channel context, system compose)는 ai-sdk `transformParams`에 둔다.
- ❌ `ScheduledMessage`는 미래 발송 1-shot이라 cron 트리거 흡수 안 함. 우리가 직접 짠다 — `docs/specs/schedules.md` 참조.

## AC

1. Slack `app_mention` 한 발이 도착했을 때, 위 1~7 흐름이 우리 얇은 앱 레이어(middleware + drain wrapper + steering)를 거쳐 응답으로 돌아온다.
2. `cronSchedule` 한 발이 발화했을 때 같은 LanguageModel 호출 경로(5~6)를 거치며, 결과가 지정된 conversation에 일반 메시지처럼 누적된다.
3. 우리가 publish하는 코드 줄 수가 v2 대비 80% 이상 줄어든다 (감각 기준; PRD `S-2` 측정의 보조 지표).
