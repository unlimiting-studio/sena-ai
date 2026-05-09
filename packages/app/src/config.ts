/**
 * `defineConfig` — sena-ai v3 앱 시그니처.
 *
 * 목표는 사용자가 provider 키, Slack 키, DATABASE_URL만 채우면 바로 실행 가능한 형태다.
 * 외부 라이브러리 객체를 직접 넘겨도 되고, 자주 쓰는 state 설정은 짧은 설정 객체로도 받는다.
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { LanguageModelMiddleware, ToolSet } from "ai";
import type { Adapter, Logger, StateAdapter } from "chat";
import type { Schedule } from "./schedules/cron.js";

export interface PostgresStateConfig {
  type: "pg";
  /** Alias names are both supported so users can map DATABASE_URL directly. */
  url?: string;
  connectionString?: string;
  keyPrefix?: string;
  logger?: Logger;
}

export interface MemoryStateConfig {
  type: "memory";
}

export type StateInput = StateAdapter | PostgresStateConfig | MemoryStateConfig;

export interface StdioMcpServerConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig;

export interface SenaConfig {
  /** `prompt: { file }` 등 파일 경로 baseDir. 기본값 `process.cwd()` */
  cwd: string;
  /** ai-sdk LanguageModelV3 — provider 한 줄 교체로 엔진 변경 (`claudeCode("sonnet")` 등) */
  model: LanguageModelV3;
  /** chat-sdk 어댑터 1개 이상 (Slack 등) */
  adapters: Adapter[];
  /** ai-sdk middleware 체인. `wrapLanguageModel` 순서대로 적용 */
  middlewares: LanguageModelMiddleware[];
  /** ai-sdk tools. API 연동/수익화 작업은 여기에 붙인다. */
  tools?: ToolSet;
  /** tool loop 최대 step 수. 기본값 5. */
  maxSteps?: number;
  /** cron 트리거 (우리가 직접 짠 schedules — chat-sdk ScheduledMessage 흡수 안 함) */
  schedules: Schedule[];
  /** chat-sdk state adapter 또는 짧은 state 설정 */
  state: StateInput;
  /** MCP 서버 설정. 0.1.x에서는 fail-fast로 막고, provider 병합 단계에서 실제 연결한다. */
  mcpServers?: Record<string, McpServerConfig>;
}

export type SenaConfigInput = Partial<SenaConfig> &
  Pick<SenaConfig, "model" | "adapters" | "state">;

/** `sena.config.ts`에서 호출하는 entry. 기본값만 채우고 실제 인스턴스화는 `run()`에서 처리한다. */
export function defineConfig(input: SenaConfigInput): SenaConfig {
  return {
    cwd: input.cwd ?? process.cwd(),
    model: input.model,
    adapters: input.adapters,
    middlewares: input.middlewares ?? [],
    tools: input.tools,
    maxSteps: input.maxSteps,
    schedules: input.schedules ?? [],
    state: input.state,
    mcpServers: input.mcpServers,
  };
}
