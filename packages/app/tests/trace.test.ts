import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
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

const mockModel: LanguageModelV3 = {
  specificationVersion: "v3",
  provider: "test",
  modelId: "test-model",
  supportedUrls: {},
  async doGenerate(): Promise<LanguageModelV3GenerateResult> {
    throw new Error("doGenerate is not used in trace tests");
  },
  async doStream(): Promise<LanguageModelV3StreamResult> {
    throw new Error("doStream is not used in trace tests");
  },
};

function promptParams(messageCount = 1): LanguageModelV3CallOptions {
  return {
    prompt: Array.from({ length: messageCount }, () => ({
      role: "user" as const,
      content: [{ type: "text" as const, text: "hello" }],
    })),
  };
}

describe("traceLogger", () => {
  it("transformParams logs turn.start", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });
    const result = await middleware.transformParams?.({
      params: promptParams(2),
      type: "stream",
      model: mockModel,
    });
    expect(result).toBeDefined();
    expect(stream.lines()).toEqual(["[test] turn.start type=stream messages=2"]);
  });

  it("transformParams logs chars for non-array prompt defensively", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });
    await middleware.transformParams?.({
      params: { prompt: "hello" } as LanguageModelV3CallOptions,
      type: "generate",
      model: mockModel,
    });
    expect(stream.lines()).toEqual(["[test] turn.start type=generate chars=5"]);
  });

  it("wrapStream logs turn.end on flush (normal completion)", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });

    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start" });
        controller.enqueue({ type: "text-delta", text: "hi" });
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    });

    const wrapped = await middleware.wrapStream?.({
      doGenerate: async () => {
        throw new Error("doGenerate is not used in this test");
      },
      doStream: async () => ({ stream: sourceStream }),
      params: promptParams(),
      model: mockModel,
    });

    expect(wrapped).toBeDefined();
    const reader = wrapped?.stream.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("reader missing");
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    const lines = stream.lines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(
      /turn\.end model=test-model elapsed=\d+ms .*stream-start=1.*text-delta=1.*finish=1/,
    );
    expect(lines[0]).not.toContain("cancelled=");
  });

  it("wrapStream logs turn.end on consumer cancel (abort/steering)", async () => {
    const stream = makeCapturedStream();
    const middleware = traceLogger({ stream, label: "test" });

    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start" });
        controller.enqueue({ type: "text-delta", text: "partial" });
      },
    });

    const wrapped = await middleware.wrapStream?.({
      doGenerate: async () => {
        throw new Error("doGenerate is not used in this test");
      },
      doStream: async () => ({ stream: sourceStream }),
      params: promptParams(),
      model: mockModel,
    });

    expect(wrapped).toBeDefined();
    const reader = wrapped?.stream.getReader();
    expect(reader).toBeDefined();
    if (!reader) throw new Error("reader missing");
    await reader.read();
    await reader.read();
    await reader.cancel("aborted by consumer");

    const lines = stream.lines();
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(
      /turn\.end model=test-model elapsed=\d+ms .*stream-start=1.*text-delta=1.*cancelled=/,
    );
  });
});
