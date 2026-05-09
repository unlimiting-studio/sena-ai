# Architecture

## 한 줄

트리거(Slack · cron) → chat-sdk 어댑터 → 우리 미들웨어(channel context · system 합성 · trace) → ai-sdk LanguageModel → provider(claude-code / codex-cli) → 엔진(Claude Code CLI / codex CLI).

## 레이어

| 레이어               | 책임                                                                            | 누가 짠 것                  |
| -------------------- | ------------------------------------------------------------------------------- | --------------------------- |
| 트리거               | Slack 이벤트 수신 / cron 발화 / 외부 시스템 입구                                | chat-sdk + cron(node-cron 또는 chat-sdk `ScheduledMessage`) |
| 어댑터               | mention · thread · reaction · button · slash · modal 라우팅, 출력(streaming · mrkdwn · unfurl · table) | `@chat-adapter/slack`         |
| **우리 미들웨어**     | per-channel context 합성 · system prompt 합성 · turn trace                       | sena-ai v3 자체 코드 (얇음)   |
| LanguageModel 추상화 | `streamText` / `generateText` / `wrapLanguageModel`                             | `ai`                          |
| provider              | LanguageModel → Claude Code CLI / codex CLI 변환                                | `ai-sdk-provider-claude-code` / `-codex-cli` |
| 엔진                  | 실제 LLM·tool call 실행                                                         | Claude Code CLI / codex CLI   |

> **우리가 직접 짜는 코드는 "우리 미들웨어" 레이어 한 덩어리뿐이다.** 그 외는 외부 라이브러리.

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

## 검증 필요

- chat-sdk가 자체 system prompt 합성 hook을 제공하면, 우리 미들웨어 1차(채널 컨텍스트)는 ai-sdk가 아니라 chat-sdk 쪽에서 끼는 게 자연스러울 수 있다. 어느 레이어에 둘지는 1차 마이그에서 결정.
- cron 트리거가 chat-sdk Conversation 입구를 거쳐야 message history가 자연스럽게 누적된다. `ScheduledMessage`가 그 역할을 하는지 — `docs/specs/schedules.md` 참조.

## AC

1. Slack `app_mention` 한 발이 도착했을 때, 위 1~7 흐름이 우리 코드의 미들웨어 한 덩어리만 거쳐 응답으로 돌아온다.
2. `cronSchedule` 한 발이 발화했을 때 같은 LanguageModel 호출 경로(5~6)를 거치며, 결과가 지정된 conversation에 일반 메시지처럼 누적된다.
3. 우리가 publish하는 코드 줄 수가 v2 대비 80% 이상 줄어든다 (감각 기준; PRD `S-2` 측정의 보조 지표).
