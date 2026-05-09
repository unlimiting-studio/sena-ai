import { describe, it, expect } from "vitest";
import { traceLogger } from "../src/middlewares/trace.js";

interface CapturedStream extends NodeJS.WritableStream {
  lines(): string[];
}

function makeCapturedStream(): CapturedStream {
  const lines: string[] = [];
  const writable: Partial<CapturedStream> = {
    write(chunk: unknown): boolean {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      for (const line of text.split("\n")) {
        if (line) lines.push(line);
      }
      return true;
    },
    lines() {
      return lines;
    },
  };
  return writable as CapturedStream;
}

describe("traceLogger", () => {
  it("transformParams logs turn.start", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });
    const result = await middleware.transformParams!({
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      params: { prompt: [{ role: "user" }, { role: "assistant" }] } as any,
      type: "stream",
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      model: { modelId: "test-model" } as any,
    });
    expect(result).toBeDefined();
    expect(stream.lines()).toEqual(["[test] turn.start type=stream messages=2"]);
  });

  it("transformParams logs chars for string prompt", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });
    await middleware.transformParams!({
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      params: { prompt: "hello" } as any,
      type: "generate",
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      model: { modelId: "test-model" } as any,
    });
    expect(stream.lines()).toEqual(["[test] turn.start type=generate chars=5"]);
  });

  it("wrapStream logs turn.end on flush (normal completion)", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });

    // 합성 stream — 정상 종료
    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start" });
        controller.enqueue({ type: "text-delta", text: "hi" });
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    });

    const wrapped = await middleware.wrapStream!({
      doStream: async () => ({ stream: sourceStream }),
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      params: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      model: { modelId: "test-model" } as any,
    });

    // consume the stream fully
    const reader = wrapped.stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const lines = stream.lines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/turn\.end model=test-model elapsed=\d+ms .*stream-start=1.*text-delta=1.*finish=1/);
    expect(lines[0]).not.toContain("cancelled=");
  });

  // codex P2 회귀 가드 — abort/steering처럼 consumer가 stream을 cancel하면
  // TransformStream.flush는 호출되지 않는다. cancel 콜백에서도 turn.end 요약을 찍어야
  // chunk 분포 분석이 가능하다.
  it("wrapStream logs turn.end on consumer cancel (abort/steering)", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });

    // 합성 stream — 종료되지 않는다 (consumer가 cancel)
    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start" });
        controller.enqueue({ type: "text-delta", text: "partial" });
        // close 안 함 — abort 시나리오 모방
      },
    });

    const wrapped = await middleware.wrapStream!({
      doStream: async () => ({ stream: sourceStream }),
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      params: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: test fixture
      model: { modelId: "test-model" } as any,
    });

    const reader = wrapped.stream.getReader();
    await reader.read(); // stream-start
    await reader.read(); // text-delta
    await reader.cancel("aborted by consumer"); // ← steering cancel

    const lines = stream.lines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/turn\.end model=test-model elapsed=\d+ms .*stream-start=1.*text-delta=1.*cancelled=/);
  });
});
