import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { channelContext } from "../src/middlewares/channel-context.js";
import { runWithTurnContext } from "../src/runtime/turn-context.js";

function baseParams(): LanguageModelV3CallOptions {
  return {
    prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
  };
}

async function makeFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sena-channel-context-"));
  await fs.mkdir(path.join(dir, "channels", "C123"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "channels.json"),
    JSON.stringify({
      channels: {
        C123: {
          name: "project-sena",
          description: "v3 migration",
          repositories: ["https://github.com/Variel/sena"],
          memory: "channels/C123/memory.md",
        },
      },
    }),
  );
  await fs.writeFile(path.join(dir, "channels", "C123", "memory.md"), "# memory\n- ship it\n");
  return dir;
}

describe("channelContext", () => {
  it("injects channel header and memory as system prompt", async () => {
    const cwd = await makeFixture();
    const middleware = channelContext({ channelsFile: "channels.json", memoryDir: "channels", cwd });

    const result = await runWithTurnContext({ channelId: "C123", trigger: "mention" }, () =>
      middleware.transformParams?.({ params: baseParams(), type: "stream", model: mockModel() }),
    );

    expect(result?.prompt[0]?.role).toBe("system");
    expect(result?.prompt[0]?.content).toContain("채널: #project-sena (C123)");
    expect(result?.prompt[0]?.content).toContain("관련 리포지토리: https://github.com/Variel/sena");
    expect(result?.prompt[0]?.content).toContain("# memory");
    expect(result?.prompt[1]?.role).toBe("user");
  });

  it("keeps params unchanged when turn has no channel id", async () => {
    const cwd = await makeFixture();
    const middleware = channelContext({ channelsFile: "channels.json", memoryDir: "channels", cwd });
    const params = baseParams();

    const result = await middleware.transformParams?.({
      params,
      type: "stream",
      model: mockModel(),
    });

    expect(result).toBe(params);
  });
});

function mockModel() {
  return {
    specificationVersion: "v3" as const,
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      throw new Error("not used");
    },
  };
}
