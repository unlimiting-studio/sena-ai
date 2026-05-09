/**
 * @sena-ai/app — entry.
 *
 * 본 마이그 §1 1단계 (skeleton). 다음 단계에서 PoC 코드를 이전하고
 * defineConfig + Chat 통합 + drain/steering/stream wrapper를 채운다.
 */

export { defineConfig } from "./config.js";
export type { SenaConfig, SenaConfigInput } from "./config.js";

// 통합 entry — step 3 산출물. `sena.config.ts` 한 호출로 베어본 에이전트가 동작.
export { run } from "./runtime/run.js";
export type { RunOptions, RunningApp, SteeringMode } from "./runtime/run.js";

// chat-sdk 부수 발견 보완 wrapper — 호출자가 직접 사용하고 싶을 때.
export { createDrainController } from "./runtime/drain.js";
export type { DrainController, DrainControllerOptions } from "./runtime/drain.js";
export { SteeringRegistry } from "./runtime/steering.js";
export type { SteeringSlot } from "./runtime/steering.js";
export { safePostStream } from "./runtime/stream.js";
export type {
  PostableThread,
  StreamableResult,
  SafePostStreamOptions,
} from "./runtime/stream.js";
export { isAbortError, abortableSleep, isChatStreamCloseNoise } from "./runtime/abort.js";
