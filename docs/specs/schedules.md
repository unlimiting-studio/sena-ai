# Schedules

**상태:** rev. 2 (PoC 0단계 검증 결과 반영).

## 한 줄

cron 표현 기반의 정기 트리거. **v2 `heartbeat()`는 별도 API로 두지 않고 `cronSchedule()` 한 함수로 통합한다.** chat-sdk `ScheduledMessage`는 *미래 발송 1-shot*이라 cron 의미를 흡수하지 않음 (PoC에서 차니 정정으로 확정). **우리가 직접 짠다.**

## 1차 가설 시그니처

```ts
interface CronScheduleSpec {
  /** unique name. 로그 / dedup용 */
  name: string;

  /** cron expression. node-cron 호환. KST 시간대로 해석 */
  cron: string;

  /** 트리거된 turn을 어디로 흘려보낼지 */
  target: ScheduleTarget;

  /** 한 turn의 입력. inline string 또는 외부 파일 lazy read */
  prompt: string | { file: string };
}

type ScheduleTarget =
  | { type: 'slack-channel'; id: string; threadTs?: string }
  | { type: 'conversation'; id: string }; // chat-sdk Conversation id

cronSchedule(spec: CronScheduleSpec): Schedule;
```

`config.schedules` 배열에 등록한다. `cwd`는 `defineConfig`의 `cwd`를 baseDir로 사용 (v2 `SchedulePromptSource` 학습).

## 동작 (1차 가설)

발화 시점에:
1. `target`이 가리키는 chat-sdk Conversation을 찾는다 (state adapter에서 history load).
2. `prompt`(인라인 또는 파일 lazy read)를 system 또는 user 메시지로 conversation에 주입한다.
3. 일반 turn flow(`docs/specs/architecture.md` §"데이터 흐름")를 그대로 탄다.
4. 결과 응답은 어댑터(예: Slack)가 `target.id`(채널 / 스레드)에 직접 게시한다.

> 핵심: cron 트리거도 일반 메시지 turn과 동일한 `LanguageModel` 호출 경로를 탄다. middleware(channel context · trace 등)가 똑같이 적용된다.

## chat-sdk `ScheduledMessage`와의 관계 ✅ 확정

`ScheduledMessage`는 *미래 시각에 1회 발송*만 하는 추상화 (Slack `chat.scheduleMessage` 위의 얇은 wrapper). cron 의미는 흡수하지 않음.

→ **우리가 직접 짠다.** PoC에서 검증한 패턴:

```ts
// 부팅 시 cronSchedule 등록
setInterval(/* 또는 node-cron */, async () => {
  const thread = chat.thread(target.threadId);  // 외부 reference
  const result = streamText({ model, prompt: prompt.text });
  await thread.post(await result.text);  // string post (부수 발견 #1 우회)
});
```

### 검증된 동작 (PoC 0단계)

- ✅ `chat.thread(threadId)` 외부 reference로 chat-sdk Conversation 진입 가능
- ✅ ai-sdk middleware (channelContext / traceLogger) 일반 mention turn과 동일하게 fire (`turn.start type=stream → turn.end ... finish=1`)
- ⚠️ **제약:** `thread.post(stream)`은 `_currentMessage` 부재로 깨짐 (부수 발견 #1). 따라서 cron 발화는 **`await result.text` 후 string post**가 1차 권고. streaming이 필요하면 wrapper 또는 upstream PR.

## 본 마이그 §1 작업

- `cronSchedule({ name, cron, target, prompt })` 1차 가설 시그니처 그대로 구현.
- 내부적으로 `node-cron` (또는 동등) + `chat.thread()` reference + `streamText` + string post.
- KST 시간대 명시 (`node-cron` `timezone: 'Asia/Seoul'`).
- 부수 발견 #1 wrapper 또는 upstream PR로 streaming 출력 복원.

## AC

1. PoC 에이전트가 `0 8 * * *` cron으로 morning briefing 한 turn을 돌리고, 결과가 지정된 Slack 채널에 일반 메시지로 게시된다.
2. cron 발화로 시작된 turn의 trace 로그가 일반 mention turn과 같은 형식으로 나온다.
3. `prompt: { file: 'briefing.md' }`가 발화 시점 lazy read로 동작한다 (재시작 없이 prompt 파일만 수정해 다음 발화에 반영).
