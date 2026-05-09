/**
 * @sena-ai/app — entry.
 *
 * 본 마이그 §1 1단계 (skeleton). 다음 단계에서 PoC 코드를 이전하고
 * defineConfig + Chat 통합 + drain/steering/stream wrapper를 채운다.
 */

export { defineConfig } from "./config.js";
export type { SenaConfig, SenaConfigInput } from "./config.js";

// chat-sdk 부수 발견 보완 wrapper — 본 마이그 §1 step 2 산출물.
//
// 의도적 비-export: `run()` / `RunningApp` / `RunOptions`.
// step 1 stub 시점에 짧게 export 되었지만 step 2에서 의도적으로 내렸다 —
// 미구현 시그니처를 외부 계약으로 약속하지 않기 위해서다 (fail-fast 정책,
// codex round 2 P1 응답). v0.1.0은 아직 외부 컨슈머가 없는 orphan v3 브랜치라
// 호환성 회귀 영향 없음. step 3에서 실제 구현과 함께 다시 export 한다.
export { createDrainController } from "./runtime/drain.js";
export type { DrainController, DrainControllerOptions } from "./runtime/drain.js";
export { SteeringRegistry } from "./runtime/steering.js";
export type { SteeringMode, SteeringSlot } from "./runtime/steering.js";
export { safePostStream } from "./runtime/stream.js";
export type {
  PostableThread,
  StreamableResult,
  SafePostStreamOptions,
} from "./runtime/stream.js";
export { isAbortError, abortableSleep, isChatStreamCloseNoise } from "./runtime/abort.js";
