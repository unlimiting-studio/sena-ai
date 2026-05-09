/**
 * cronSchedule — `docs/specs/schedules.md` (rev. 2) 1차 가설 시그니처.
 *
 * 1단계(skeleton): 시그니처만. 다음 단계에서 node-cron 등 라이브러리 결정 + 실 트리거 구현.
 */

/**
 * cron 발화 결과를 어디에 게시할지.
 *
 * 1차 (step 4):
 *  - `slack-channel` (+ optional `threadTs`) 만 지원.
 *
 * step 5+:
 *  - `{ type: "conversation"; id }` — chat-sdk Conversation id 가 transport-scoped thread key
 *    (`slack:C123:1234.567`) 와 같은 형태인지 SPEC 미지수가 닫힌 후 추가.
 */
export type ScheduleTarget = {
  type: "slack-channel";
  id: string;
  threadTs?: string;
};

export interface CronScheduleSpec {
  /** unique name. 로그 / dedup용 */
  name: string;
  /** cron 표현. KST 시간대 해석 (구현 시 timezone: 'Asia/Seoul' 명시) */
  cron: string;
  /** 트리거된 turn을 어디로 흘려보낼지 */
  target: ScheduleTarget;
  /** turn 입력 — inline string 또는 외부 파일 lazy read */
  prompt: string | { file: string };
}

export interface Schedule {
  readonly spec: CronScheduleSpec;
}

export function cronSchedule(spec: CronScheduleSpec): Schedule {
  return { spec };
}
