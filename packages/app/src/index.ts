/**
 * @sena-ai/app — entry.
 *
 * 본 마이그 §1 1단계 (skeleton). 다음 단계에서 PoC 코드를 이전하고
 * defineConfig + Chat 통합 + drain/steering/stream wrapper를 채운다.
 */

export { defineConfig } from "./config.js";
export type { SenaConfig, SenaConfigInput } from "./config.js";
export { run } from "./runtime/run.js";
