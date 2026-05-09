/**
 * schedules — cron 트리거 (우리가 직접 짠다, chat-sdk ScheduledMessage는 별개).
 *
 * node-cron 기반 fan-out은 runtime/scheduleFanOut.ts에서 실제 등록한다.
 * 패턴: cron tick → `chat.thread()/channel()` reference → `streamText` →
 *      `await result.text` → `post(string)` (PoC 발견 #1 우회).
 */

export { cronSchedule } from "./cron.js";
export type { CronScheduleSpec, ScheduleTarget } from "./cron.js";
