/**
 * schedules — cron 트리거 (우리가 직접 짠다, chat-sdk ScheduledMessage는 별개).
 *
 * 1단계(skeleton): 시그니처만. 다음 단계에서 PoC cron-demo 패턴을 일반화.
 * 패턴: 외부 cron(node-cron 등) → `chat.thread(threadId)` reference → `streamText` →
 *      `await result.text` → `thread.post(string)` (PoC 발견 #1 우회).
 */

export { cronSchedule } from "./cron.js";
export type { CronScheduleSpec, ScheduleTarget } from "./cron.js";
