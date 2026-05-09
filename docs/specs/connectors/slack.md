# Slack Connector

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

이 정책들은 chat-sdk 핸들러 안에서 재구현한다. **chat-sdk가 핸들러 미들웨어(before-respond 류)를 노출하면** 그 위에서 짠다 (검증 필요).

## 출력 정책

**우리가 정의하지 않는다.** 어댑터의 표준 동작:
- streaming preview (chat.startStream / appendStream / stopStream 등)
- mrkdwn 변환 / 인용 / 강조 / 코드블록
- URL unfurl
- table / divider / button block

v2에서 우리가 디버그한 디테일(`parse:'none'` 양립 불가, mrkdwn 이중 꺾쇠 보존, archive permalink labeling, 1.5초 throttle trailing flush, dedup race) → **어댑터가 자체 처리한다고 1차 가정.** 어댑터가 미커버하는 항목은 PRD §10 일정의 *"5/21 ~ 5/27 Slack 디테일 전수조사"* 슬롯에서 확인 후 wrapper 또는 upstream PR로 처리.

## State (Session) 영속성

chat-sdk 자체 state adapter 사용 — `state-pg` / `state-redis` / `state-ioredis` / `state-memory` 중. **선택은 차니 결정 대기** (PRD §11).

`state-memory`로 시작하면 PoC는 동작하지만 재시작 시 conversation history 손실. 본 마이그 전엔 `state-pg` 또는 `state-redis`로 전환.

## 검증 필요

- `@chat-adapter/slack` 패키지명·옵션 키·trigger 핸들러 시그니처. 사이트에는 `onNewMention`만 명시됨, 나머지(message / reaction / button / slash / modal)는 코드를 까서 확인.
- 우리가 v2에서 디버그한 출력 디테일이 어댑터에 적용돼 있는지 — 미커버 표는 1차 마이그 직후 별도 wiki에.
- Socket Mode와 HTTP Events API 중 어댑터 권장 모드, multi-instance 운영 시 어떤 게 안전한지.

## AC

1. PoC 에이전트가 Slack 채널에서 mention 받으면, 어댑터를 거쳐 LanguageModel 호출까지 도달하고 응답이 streaming으로 표시된다.
2. URL을 포함한 응답에서 unfurl이 정상 발생한다 (v2 `parse:'none'` 회귀 없음).
3. `:x:` reaction이 달렸을 때 진행 중인 turn이 abort된다 (v2 reaction abort 정책 호환).
4. 한 thread에서 멘션 한 번 한 후, 같은 thread의 후속 message가 멘션 없이도 봇에게 라우팅된다.
