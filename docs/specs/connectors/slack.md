# Slack Connector

**상태:** rev. 2 (PoC 0단계 검증 결과 반영).

## 한 줄

`chat` + `@chat-adapter/slack`을 채택한다. mrkdwn / streaming / unfurl / table / archive permalink 같은 출력 디테일은 **어댑터 동작을 그대로 따른다** (PRD FR-3). 우리는 trigger 정책과 채널 라우팅만 짠다.

## 채택 결정

PRD §1 배경 — Slack 디테일 영역에서 v2가 시간을 가장 많이 쓴 영역. 우리가 직접 짠 `@sena-ai/slack-mrkdwn` / `connector-slack` / `tools-slack`은 v3에서 사라진다.

## 어댑터 등록 (1차 가설)

```ts
import { slackAdapter } from '@chat-adapter/slack';

slackAdapter({
  botToken: process.env.SLACK_BOT_TOKEN!,    // xoxb-
  appToken: process.env.SLACK_APP_TOKEN!,    // xapp- (Socket Mode)
  // 또는 HTTP Events API 모드 — 어댑터가 둘 다 지원하면 그대로
});
```

(어댑터의 정확한 옵션 키는 `@chat-adapter/slack` 문서 1차 검증 — 위는 가설.)

## Trigger 정책

chat-sdk 어댑터가 표준으로 지원하는 trigger 종류 (사이트 명시):
- mention (`onNewMention`)
- message
- reaction
- button
- slash command
- modal

v2에서 우리가 짰던 trigger 정책 중 v3로 옮겨야 할 것:
- `mention > thread > channel` 우선순위
- thread 안에서 봇이 멘션받았던 적이 있으면 `activeThread`로 등록 → 후속 message도 처리 (v2 `wasBotMentionedInThread`)
- reaction abort (예: `:x:` reaction이 달리면 진행 중인 turn abort)
- `triggers.filter(event)` 콜백으로 channelId / userId / text / ts / threadTs / reaction / raw 기준 무시

step 4 (현재)는 chat-sdk 어댑터의 `onNewMention` / `onSubscribedMessage` 자동 라우팅에 의존한다. `triggers.filter(event)` API와 reaction abort 재구현은 아직 미구현이며 step 5+에서 구현한다. 2026-04-04 채널 메모리의 "Slack 커넥터 trigger 설정 스펙 확장" 풀 스펙은 그대로 유효하고, 본 문서는 구현 시점만 이월한다.

### Drain 시 안내

SIGTERM 이후 drain 모드에서 새 메시지가 들어오면 핸들러 공통 `gracefulDrainSkip`이 아래 안내를 `thread.post`로 보낸 뒤 skip한다.

`⏳ 재시작 중이라 이번 메시지는 처리할 수 없어요. 잠시 후 다시 보내주세요.`

이유: chat-sdk/Slack 이벤트는 한 번 소비되면 새 인스턴스로 자동 재전달되지 않는다. 그래서 "다음 인스턴스가 받을게요"가 아니라 "이번 요청은 드롭, 다시 보내달라"를 명시한다.

## 출력 정책

**우리가 정의하지 않는다.** 어댑터의 표준 동작:
- streaming preview (chat.startStream / appendStream / stopStream 등)
- mrkdwn 변환 / 인용 / 강조 / 코드블록
- URL unfurl
- table / divider / button block

v2에서 우리가 디버그한 디테일(`parse:'none'` 양립 불가, mrkdwn 이중 꺾쇠 보존, archive permalink labeling, 1.5초 throttle trailing flush, dedup race) → **어댑터가 자체 처리한다고 1차 가정.** 어댑터가 미커버하는 항목은 PRD §10 일정의 *"5/21 ~ 5/27 Slack 디테일 전수조사"* 슬롯에서 확인 후 wrapper 또는 upstream PR로 처리.

## State (Session) 영속성 ✅ 확정

**`@chat-adapter/state-pg` 채택** (PoC 0단계 라이브 검증 완료, 2026-05-10).

`createPostgresState({ url, keyPrefix })` 한 줄 등록 → 부팅 시 자동으로 5개 테이블 생성:
- `chat_state_subscriptions` — `thread.subscribe()` 영속. **재시작 후 follow-up 메시지가 `onSubscribedMessage`로 라우팅되는 핵심.**
- `chat_state_locks` — thread별 동시성 제어
- `chat_state_queues` — concurrency=queue/debounce 모드의 pending 메시지
- `chat_state_cache` — TTL 있는 KV (chat-sdk message metadata 등)
- `chat_state_lists` — `appendToList` / `getList` 형태

### codex/claude-code 자체 state와 역할 분리

| | codex/claude-code (`~/.claude/projects/*.jsonl`) | chat-sdk state-pg |
|---|---|---|
| 보관 대상 | 모델 conversation context | thread routing/concurrency 메타데이터 |
| 영속 단위 | session ID 단위 message history | thread/channel 단위 subscribe·lock·queue |
| 재시작 영향 | provider 자체 resume으로 회복 | state adapter가 책임 |

→ 둘이 역할이 다르고 둘 다 필요. v2 `wasBotMentionedInThread()` 우회 패턴이 정확히 chat-sdk state 부재로 생긴 인메모리 한계였고, state-pg가 이걸 native 해결.

## 검증 결과 (rev. 2)

- ✅ `@chat-adapter/slack@4.28.1` 시그니처: `createSlackAdapter({ mode: 'socket', appToken, botToken })`. `onNewMention` / `onSubscribedMessage` / `onDirectMessage` / `onReaction` / `onSlashCommand` / `onModalSubmit` / `onNewMessage` 모두 노출.
- ✅ Socket Mode 1급 지원. **같은 xapp 토큰으로 다중 인스턴스 동시 socket connect 가능** (Slack 공식 멀티 소켓 분산 라우팅) — zero-downtime rolling restart 패턴 가능.
- ✅ `markdown_text` native 처리 (Slack 자체 mrkdwn 렌더링 경로 위임). v2 `@sena-ai/slack-mrkdwn` 자체 변환 불필요.
- ✅ `PostableMessage`가 ai-sdk `fullStream`을 native 흡수 (text-delta 자동 추출).

## 부수 발견 (PoC 0단계, 본 마이그 §1에서 wrapper)

1. **`Thread.handleStream` 외부 reference에서 깨짐** (`chat/dist/index.js:1631`) — `chat.thread(id)`로 만든 reference에서 stream post 시 `_currentMessage.author.userId` undefined dereference. cron 발화 등 incoming message 없는 시나리오에서 streaming 출력 불가. 우리는 `await result.text` 후 string post로 우회.
2. **abort 시 `chatStream.stop()`이 `not_authed`** (`@chat-adapter/slack/dist/index.js:3386`) — 새 turn에는 영향 없지만 abort된 stream 클로즈 처리가 깨끗하지 않음. wrapper에서 swallow.
3. **`Chat.shutdown()` in-flight handler drain 부재** (`chat/dist/index.js:2454-2476`) — 우리 `inFlight` 카운터 + drain 루프 wrapper로 메움.

## 운영 노트 (2026-05-10 라이브 운영)

1. **lily subscription leak (live)** — chat-sdk `onNewMention`의 기본 `thread.subscribe()` 경로 때문에 stable 채널의 active thread마다 `chat_state_subscriptions` row가 누적되면, 이후 해당 thread 후속 메시지가 멘션 없이도 `onSubscribedMessage`로 계속 라우팅되어 in-flight 핸들러가 급증할 수 있다. 임시 해소는 운영자 manual 대응으로, `psql`에서 `chat_state_subscriptions`의 해당 thread row를 수동 `DELETE`한다 (자동 폴백/바이패스 없음). 정식 해소는 step 5+로 이월: `triggers.filter(event)` 기반 자동 subscribe 차단 옵션, 봇의 자동 unsubscribe 도구 노출, mention 시 자동 subscribe default를 opt-in으로 바꾸는 옵션 검토.
2. **`streamText` abort unhandled rejection 안전망 (live)** — steering interrupt 등으로 `controller.abort()`가 발생하면 ai-sdk `streamText` result의 background promise(`text`, `usage`, `finishReason` 등)가 동시 reject될 수 있다. 패키지 단에서는 `silenceStreamTextRejections(result)`를 queue/steering/step/scheduleFanOut 핸들러에 공통 적용해 noop catch를 선등록한다. 운영 단에서는 process-level `process.on("unhandledRejection", ...)` listener를 추가 권장한다 (sena-bare에는 반영됨, starter 템플릿 `templates/slack-agent/src/index.ts`에는 아직 없음). ai-sdk root fix는 step 5+ 범위.

## AC

1. PoC 에이전트가 Slack 채널에서 mention 받으면, 어댑터를 거쳐 LanguageModel 호출까지 도달하고 응답이 streaming으로 표시된다.
2. URL을 포함한 응답에서 unfurl이 정상 발생한다 (v2 `parse:'none'` 회귀 없음).
3. `:x:` reaction abort 정책은 step 5+에서 `triggers.filter(event)` 계열과 함께 재구현한다 (step 4 현재 미구현).
4. 한 thread에서 멘션 한 번 한 후, 같은 thread의 후속 message가 멘션 없이도 봇에게 라우팅된다.
