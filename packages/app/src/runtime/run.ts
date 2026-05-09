/**
 * 앱 entry. `sena.config.ts` 를 받아 Chat 인스턴스를 만들고
 * drain wrapper · steering 레이어 · schedules · MCP bridge 를 깐다.
 *
 * 1단계 (skeleton): stub. 다음 단계에서 PoC `~/agents/sena-poc/src/index.ts`를
 * 이전·일반화하면서 채운다.
 */

import type { SenaConfig } from "../config.js";

export interface RunOptions {
  /** SIGTERM 받았을 때 in-flight turn 드레인 timeout (기본 60s) */
  drainTimeoutMs?: number;
}

export async function run(_config: SenaConfig, _options: RunOptions = {}): Promise<void> {
  throw new Error(
    "[@sena-ai/app] run() not implemented yet. " +
      "본 마이그 §1 다음 단계에서 PoC 코드를 이전한다.",
  );
}
