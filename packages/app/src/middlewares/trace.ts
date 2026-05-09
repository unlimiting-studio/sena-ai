/**
 * traceLogger — ai-sdk LanguageModelV3Middleware
 *
 * `transformParams` (turn 진입 trace) + `wrapStream` (chunk 분포 trace)
 * 양쪽 hook에 fire. PoC `~/agents/sena-poc/src/middlewares/trace.ts` 이전 예정.
 *
 * 1단계(skeleton): 시그니처만.
 */

import type { LanguageModelMiddleware } from "ai";

export interface TraceLoggerOptions {
  /** 로그 prefix. 기본 `sena` */
  label?: string;
  /** 로그 stream. 기본 stdout */
  stream?: NodeJS.WritableStream;
}

export function traceLogger(_options: TraceLoggerOptions = {}): LanguageModelMiddleware {
  // 1단계 stub — 다음 단계에서 PoC `~/agents/sena-poc/src/middlewares/trace.ts` 코드 이전.
  return {
    specificationVersion: "v3",
  };
}
