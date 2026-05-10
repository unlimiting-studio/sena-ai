# Schedules

**상태:** rev. 3 (§1 step 4 + step 4.5 + step 4.6 + step 4.7 구현 결과 반영. rev. 2 ↔ 코드 정면 모순 fix).

## 한 줄

cron 표현 기반의 정기 트리거. **v2 `heartbeat()`는 별도 API로 두지 않고 `cronSchedule()` 한 함수로 통합한다.** chat-sdk `ScheduledMessage`는 *미래 발송 1-shot*이라 cron 의미를 흡수하지 않음 (PoC에서 차니 정정으로 확정). **우리가 직접 짠다.**

## 1차 가설 시그니처 (step 4 구현 확정)

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

// step 4 (53649b7): union 좁힘 — slack-channel 만 1차 지원.
type ScheduleTarget = {
  type: 'slack-channel';
  id: string;
  threadTs?: string;
};

cronSchedule(spec: CronScheduleSpec): Schedule;
```

`config.schedules` 배열에 등록한다. `cwd`는 `defineConfig`의 `cwd`를 baseDir로 사용 (v2 `SchedulePromptSource` 학습).

### `conversation` target 은 step 5+ 로 미룸

rev. 2 의 `{ type: 'conversation'; id: string }` (chat-sdk Conversation id) 분기는 step 4 (`53649b7`) 에서 union 에서 빼고 **step 5+ 로 미뤘다**. 이유: chat-sdk 가 받는 ID 가 transport-scoped thread key (`slack:C123:1234.567`) 와 같은 형태인지 SPEC 미지수가 닫히지 않은 상태에서 1차에 통과시키면 silent miss 가능 (codex P1 round 4). 미지수가 닫힌 후 부활. 그 전엔 `slack-channel + threadTs` 로 마이그레이션.

런타임 가드: `packages/app/src/runtime/scheduleFanOut.ts` 의 `resolveTarget()` 은 `target.type !== 'slack-channel'` 시 fail-fast (이전 빌드 / JS 설정에서 conversation 객체가 들어와도 silent dispatch 안 함).

## 동작 (step 4 + step 4.5 롤백 결정)

cron 발화 시점에:

1. `prompt` 를 발화 시점에 lazy 로 읽는다 (string 그대로 또는 `{ file }` → `defineConfig.cwd` 기준 `fs.readFile`). 재시작 없이 prompt 파일만 수정해 다음 발화에 반영.
2. `streamText({ model, tools, stopWhen, prompt })` 호출 — *prior history 없이 prompt-only*. `runWithTurnContext({ adapter, channelId, threadId, trigger: 'schedule' })` 안에서 호출하므로 일반 turn 과 동일하게 middleware(channelContext / traceLogger / 외 사용자 middleware) 가 적용된다.
3. `await result.text` 으로 string 출력. PoC 발견 #1 우회 (`Thread.handleStream` 외부 reference 깨짐).
4. `target.threadTs` 유무에 따라 dispatch 분기 (아래 §"target 분기").
5. 발화 turn 도 `drain.track('schedule:{name}', ...)` 으로 감싸 SIGTERM 시 in-flight cron 도 같이 drain.

> 핵심: cron 트리거도 일반 메시지 turn과 동일한 `LanguageModel` 호출 경로를 탄다. middleware(channel context · trace 등)가 똑같이 적용된다.

### step 4.5 — history-aware 시도 후 롤백 결정 (기록)

`fe91d92` 에서 차니 우려 — *"state 가 chat-sdk 에 저장되는데 cron 이 chat-sdk 우회하면 다른 채팅 간 호환성 깨지지 않을지"* — 를 두고 history-aware 모드를 잠깐 시도했다가 **롤백**:

- **outbound** (cron 응답이 chat-sdk thread/channel state 에 어떻게 기록되는가): 이미 깨끗. cron 발화 끝에 `thread.post(text) / channel.post(text)` 를 chat-sdk 통해 호출하므로 일반 mention turn 의 응답과 똑같이 state-pg 에 기록. 호환성 안 깨짐.
- **inbound** (cron 발화가 prior history 를 읽고 답해야 하는가): cron 은 *stand-alone trigger* 라 history 의존 없는 게 본질에 맞다. history-aware 모드를 시도했을 때 두 회귀 (codex round 2) — ① 채널 dispatch 시 채널 임의 잡담이 모델 input 에 섞임 ② thread dispatch 시 cron prompt 가 thread 에 안 남아 다음 발화 history 가 assistant-only 비대칭 → 롤백.
- **결정**: rev. 2 §"동작 (1차 가설)" 1번의 `"target 이 가리키는 chat-sdk Conversation 을 찾는다 (state adapter 에서 history load)"` 는 **prompt-only 직행** 으로 정정. history-aware 가 정말 필요한 시나리오 (예: thread 안에서 누적되는 정기 리포트) 는 step 5+ 에서 별도 다룬다.

### target 분기 (step 4 구현)

`runtime/scheduleFanOut.ts` `resolveTarget()` — `target.id` 가 `:` 를 포함하면 prefix 박힌 것으로 보고 그대로 재사용 (다중 어댑터 호환), 아니면 `slack:` prefix 자동 합성:

| `threadTs` 유무 | 합성 ID | dispatch |
|---|---|---|
| 있음 | `slack:{id}:{threadTs}` | `chat.thread(id).post(text)` (codex P1 round 1 — 기존 thread 에 follow-up) |
| 없음 | `slack:{id}` | `chat.channel(id).post(text)` (SPEC AC 1 — 아침 브리핑 등 채널 신규 메시지) |

## chat-sdk `ScheduledMessage`와의 관계 ✅ 확정

`ScheduledMessage`는 *미래 시각에 1회 발송*만 하는 추상화 (Slack `chat.scheduleMessage` 위의 얇은 wrapper). cron 의미는 흡수하지 않음.

→ **우리가 직접 짠다.** step 4 (`53649b7`) 구현 패턴:

```ts
// 부팅 시 cronSchedule 등록 (runtime/scheduleFanOut.ts)
nodeCron.schedule(
  spec.cron,
  async () => {
    if (stopping || drain.draining) return;
    await drain.track(`schedule:${spec.name}`, async () => {
      const promptText = await resolvePromptText(spec.prompt, cwd);
      const target = resolveTarget(spec.target, spec.name);
      const result = runWithTurnContext({ adapter: 'slack', channelId, threadId, trigger: 'schedule' }, () =>
        streamText({ model, tools, stopWhen: tools ? stepCountIs(maxSteps ?? 5) : undefined, prompt: promptText }),
      );
      silenceStreamTextRejections(result); // step 4.7 (f028ef7)
      const text = await result.text;
      if (target.kind === 'thread') await chat.thread(target.threadId).post(text);
      else await chat.channel(target.channelId).post(text);
    });
  },
  { timezone: 'Asia/Seoul', name: spec.name, noOverlap: true },
);
```

### 검증된 동작 (PoC 0단계 + step 4 구현)

- ✅ `chat.thread(threadId)` / `chat.channel(channelId)` 외부 reference 로 chat-sdk 진입 가능 (PoC 0단계).
- ✅ ai-sdk middleware (channelContext / traceLogger) 일반 mention turn과 동일하게 fire (`turn.start type=stream → turn.end ... finish=1`).
- ✅ `noOverlap=true` 로 같은 task 의 중첩 실행 차단 (codex P2 round 1) — 한 turn 이 cron 주기보다 길어져도 다음 tick 은 skip 되어 동일 채널 중복 발화 방지.
- ✅ `stopping` flag + `drain.draining` 이중 가드로 shutdown race 차단 (codex P2 round 5) — `fanOut.stop()` 첫 줄에 `stopping=true` 박아 이미 event loop 에 올라간 tick 도 첫 줄에서 빠짐.
- ✅ 부분 등록 후 throw 시 already-registered task rollback (codex P1 round 2) — `nodeCron.validate()` + `resolveTarget()` 검증을 모든 spec 에 *먼저* 돌리고, 등록 도중 시스템 에러로 throw 시 만들어진 task 들을 `stop+destroy` 로 rollback.
- ⚠️ **제약:** `thread.post(stream)`은 `_currentMessage` 부재로 깨짐 (부수 발견 #1). 따라서 cron 발화는 **`await result.text` 후 string post**가 1차 권고. streaming이 필요하면 wrapper 또는 upstream PR.

## 1차 구현 항목 (step 4 + step 4.6 + step 4.7)

| 항목 | 결정 / 구현 | 출처 |
|---|---|---|
| cron 라이브러리 | `node-cron` (`nodeCron.schedule(expr, cb, opts)`) | step 4 `53649b7` |
| 시간대 | `timezone: 'Asia/Seoul'` (KST 명시) | step 4 |
| 중첩 방지 | `noOverlap: true` | step 4 codex P2 round 1 |
| prompt 입력 | `string` 또는 `{ file }` lazy `fs.readFile` (cwd 기준) | step 4 |
| 출력 | `await result.text` → `thread.post(text)` / `channel.post(text)` | step 4 |
| drain | 발화마다 `drain.track('schedule:{name}', ...)` | step 4 |
| shutdown race 차단 | `stopping` flag (1순위) + `drain.draining` (fallback) | codex P2 round 5 |
| target 분기 | `threadTs` 유/무 → thread / channel | codex P1 round 1 |
| `tools` / `maxSteps` | `streamText({ tools, stopWhen: stepCountIs(maxSteps ?? 5) })` — schedule 발화도 일반 turn 과 동일하게 tool 사용 | step 4.6 `cbc0208` |
| unhandled rejection 봉합 | `silenceStreamTextRejections(result)` 14 필드 noop catch | step 4.7 `f028ef7` |
| 운영 안전망 | 발화 단위 try/catch 로 cron 에러를 swallow + 로그 (다음 tick 영향 없음) | step 4 |

## 본 마이그 §1 작업

- ✅ `cronSchedule({ name, cron, target, prompt })` 1차 가설 시그니처 그대로 구현 (step 4 `53649b7`).
- ✅ 내부적으로 `node-cron` + `chat.thread()/channel()` reference + `streamText` + string post.
- ✅ KST 시간대 명시 (`node-cron` `timezone: 'Asia/Seoul'`).
- ✅ history-aware 잠깐 시도 후 롤백, prompt-only 직행 결정 기록 (step 4.5 `fe91d92`).
- ✅ tools/maxSteps 적용 (step 4.6 `cbc0208`).
- ✅ unhandled rejection 봉합 (step 4.7 `f028ef7`).
- ⏳ 부수 발견 #1 wrapper 또는 upstream PR로 streaming 출력 복원 → step 5+.
- ⏳ `conversation` ScheduleTarget type 부활 (chat-sdk Conversation id 매핑 닫힌 후) → step 5+.

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
