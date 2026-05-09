/**
 * `defineConfig` — sena-ai v3 앱 1차 가설 시그니처.
 * `docs/specs/config.md` (rev. 2) 그대로.
 *
 * 1단계(skeleton)에서는 타입만 박아둔다. 실제 통합(`Chat` 인스턴스 생성·middleware
 * wrap·drain wrapper·steering 레이어)은 `runtime/run.ts`에서 처리하는데,
 * 이번 단계에서는 entry stub만 둔다.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";
import type { Schedule } from "./schedules/cron.js";

// chat-sdk·state types — 1차 가설은 그대로 위임.
// (구체 import는 다음 단계에서 PoC 코드 이전 시 채운다.)
type ChatAdapter = unknown;
type StateAdapter = unknown;
type McpServerConfig = unknown;

export interface SenaConfig {
  /** `prompt: { file }` 등 파일 경로 baseDir. 기본값 `process.cwd()` */
  cwd: string;
  /** ai-sdk LanguageModelV3 — provider 한 줄 교체로 엔진 변경 (`claudeCode("sonnet")` 등) */
  model: LanguageModelV3;
  /** chat-sdk 어댑터 1개 이상 (Slack 등) */
  adapters: ChatAdapter[];
  /** ai-sdk middleware 체인. `wrapLanguageModel` 순서대로 적용 */
  middlewares: LanguageModelMiddleware[];
  /** cron 트리거 (우리가 직접 짠 schedules — chat-sdk ScheduledMessage 흡수 안 함) */
  schedules: Schedule[];
  /** chat-sdk state adapter — 권장: `@chat-adapter/state-pg` */
  state: StateAdapter;
  /** MCP 서버 설정 */
  mcpServers?: Record<string, McpServerConfig>;
}

export type SenaConfigInput = Partial<SenaConfig> &
  Pick<SenaConfig, "model" | "adapters" | "state">;

/**
 * `sena.config.ts`에서 호출하는 entry. 1단계는 타입 가드만 하고 그대로 반환.
 */
export function defineConfig(input: SenaConfigInput): SenaConfig {
  return {
    cwd: input.cwd ?? process.cwd(),
    model: input.model,
    adapters: input.adapters,
    middlewares: input.middlewares ?? [],
    schedules: input.schedules ?? [],
    state: input.state,
    mcpServers: input.mcpServers,
  };
}
