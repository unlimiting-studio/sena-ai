/**
 * channelContext — ai-sdk LanguageModelV3Middleware
 *
 * `channels.json` + per-channel `memory.md`를 한 turn의 system prompt에 합성.
 * `docs/specs/channels.md` (rev. 2) — 합성 위치는 ai-sdk middleware `transformParams`로 확정.
 *
 * 1단계(skeleton): 시그니처만.
 */

import type { LanguageModelMiddleware } from "ai";

export interface ChannelContextOptions {
  /** channels.json 경로 (cwd 기준) */
  channelsFile: string;
  /** per-channel memory.md 디렉토리 (cwd 기준) */
  memoryDir: string;
}

export function channelContext(_options: ChannelContextOptions): LanguageModelMiddleware {
  // 1단계 stub — 다음 단계에서 PoC 패턴 + v2 channelContext 코드 합쳐서 작성.
  return {
    specificationVersion: "v3",
  };
}
