# Schedules

## 한 줄

cron 표현 기반의 정기 트리거. **v2 `heartbeat()`는 별도 API로 두지 않고 `cronSchedule()` 한 함수로 통합한다.** chat-sdk `ScheduledMessage` 클래스가 같은 일을 하는지가 1차 검증 포인트.

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

## chat-sdk `ScheduledMessage`와의 관계

chat-sdk가 노출하는 `ScheduledMessage` 클래스는 — *message를 미래에 보내는* 추상화로 보인다(추정, API 문서 추가 검토 필요). 우리 `cronSchedule`은 *비대화 trigger로 한 턴을 돌리는 것*이라 의미가 다를 수 있다.

| 케이스                                         | 1차 처리                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `ScheduledMessage`가 cron 표현을 받고 conversation에 message 주입까지 책임진다 | 우리 `cronSchedule`을 `ScheduledMessage` 위의 얇은 래퍼로 둔다.            |
| `ScheduledMessage`가 단순 *지연 발송*만 한다     | 우리가 직접 `node-cron`으로 발화하고, 발화 시 chat-sdk Conversation에 message 주입. |

→ 1차 마이그에서 검증.

## 검증 필요

- `ScheduledMessage`의 정확한 시그니처와 트리거 모델 (cron 표현 / interval / 한 번 발사 등).
- 시간대 처리 — chat-sdk가 UTC를 기본으로 한다면 우리가 KST 변환을 책임져야 한다.
- 발화 결과를 어댑터가 채널에 게시할 때, 일반 응답과 streaming 정책이 동일한지 (Slack streaming 동작이 일반 message와 같은지).

## AC

1. PoC 에이전트가 `0 8 * * *` cron으로 morning briefing 한 turn을 돌리고, 결과가 지정된 Slack 채널에 일반 메시지로 게시된다.
2. cron 발화로 시작된 turn의 trace 로그가 일반 mention turn과 같은 형식으로 나온다.
3. `prompt: { file: 'briefing.md' }`가 발화 시점 lazy read로 동작한다 (재시작 없이 prompt 파일만 수정해 다음 발화에 반영).
