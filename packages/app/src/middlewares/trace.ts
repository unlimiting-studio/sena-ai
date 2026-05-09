/**
 * traceLogger — ai-sdk LanguageModelV3Middleware
 *
 * `transformParams`로 turn 진입을, `wrapStream`으로 chunk 분포를 stdout에 한 줄씩 찍는다.
 * PoC `sena-poc/src/middlewares/trace.ts` 이전. PoC 라이브 검증으로 모든 chunk type
 * (`stream-start / response-metadata / reasoning-* / tool-input-* / tool-call /
 * tool-result / text-* / finish`)이 노출되는 것 확인됨.
 */

import type { LanguageModelMiddleware } from "ai";

export interface TraceLoggerOptions {
  /** 로그 prefix. 기본 `sena` */
  label?: string;
  /** 로그 stream. 기본 `process.stdout` */
  stream?: NodeJS.WritableStream;
}

export function traceLogger(options: TraceLoggerOptions = {}): LanguageModelMiddleware {
  const label = options.label ?? "sena";
  const stream = options.stream ?? process.stdout;

  const writeLine = (line: string): void => {
    stream.write(`${line}\n`);
  };

  return {
    specificationVersion: "v3",

    transformParams: async ({ params, type }) => {
      // ai-sdk `prompt`는 `string | ModelMessage[]`이므로, 문자열 프롬프트에서는
      // `.length`가 글자 수가 되어 trace를 오해하게 만든다 (codex P3). 메시지 배열일
      // 때만 messages= 카운트, 문자열일 때는 chars= 형태로 분리해서 찍는다.
      const prompt = params.prompt;
      // ai-sdk LanguageModelV3CallOptions 의 `prompt` 타입은 v3 사양에서 ModelMessage[]
      // 한 가지로 좁혀지지만, 호환을 위해 string 케이스도 안전하게 다룬다.
      const promptInfo = Array.isArray(prompt)
        ? `messages=${prompt.length}`
        : `chars=${String(prompt).length}`;
      writeLine(`[${label}] turn.start type=${type} ${promptInfo}`);
      return params;
    },

    wrapStream: async ({ doStream, model }) => {
      const start = Date.now();
      const result = await doStream();

      const counts = new Map<string, number>();
      // abort/steering 시 consumer가 stream을 cancel하면 TransformStream의 `flush`는
      // 호출되지 않는다 (codex P2). ReadableStream을 직접 만들어 정상 종료(close), 에러,
      // consumer cancel 세 경로 모두에서 turn.end 요약을 한 번만 찍는다.
      let turnEndLogged = false;
      const writeTurnEnd = (suffix: string): void => {
        if (turnEndLogged) return;
        turnEndLogged = true;
        const elapsed = Date.now() - start;
        const summary = Array.from(counts.entries())
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
        writeLine(
          `[${label}] turn.end model=${model.modelId} elapsed=${elapsed}ms ${summary}${suffix}`,
        );
      };

      const sourceReader = result.stream.getReader();
      const transformedStream = new ReadableStream<(typeof result.stream extends ReadableStream<infer P> ? P : never)>({
        async pull(controller) {
          try {
            const { done, value } = await sourceReader.read();
            if (done) {
              writeTurnEnd("");
              controller.close();
              return;
            }
            counts.set(value.type, (counts.get(value.type) ?? 0) + 1);
            controller.enqueue(value);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            writeTurnEnd(` error=${JSON.stringify(message)}`);
            controller.error(err);
          }
        },
        async cancel(reason) {
          const reasonText = reason instanceof Error ? reason.message : (reason ?? "cancelled");
          writeTurnEnd(` cancelled=${JSON.stringify(String(reasonText))}`);
          await sourceReader.cancel(reason);
        },
      });

      return { ...result, stream: transformedStream };
    },
  };
}
