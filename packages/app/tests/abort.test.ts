import { describe, it, expect } from "vitest";
import { abortableSleep, isAbortError, isChatStreamCloseNoise } from "../src/runtime/abort.js";

describe("abortableSleep", () => {
  it("resolves after the given delay when not aborted", async () => {
    const controller = new AbortController();
    const start = Date.now();
    await abortableSleep(50, controller.signal);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(150);
  });

  it("rejects with AbortError when aborted mid-sleep", async () => {
    const controller = new AbortController();
    const sleepPromise = abortableSleep(10_000, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(sleepPromise).rejects.toThrowError(/aborted/i);
  });

  it("rejects immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(1_000, controller.signal)).rejects.toThrowError(/aborted/i);
  });
});

describe("isAbortError", () => {
  it("identifies DOMException with name=AbortError", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isAbortError(err)).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("string")).toBe(false);
  });
});

describe("isChatStreamCloseNoise", () => {
  it("identifies Slack platform error with not_authed code", () => {
    const err = { data: { error: "not_authed" } };
    expect(isChatStreamCloseNoise(err)).toBe(true);
  });

  it("identifies stream_closed errors", () => {
    expect(isChatStreamCloseNoise({ data: { error: "stream_closed" } })).toBe(true);
    expect(isChatStreamCloseNoise(new Error("Stream closed"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isChatStreamCloseNoise(new Error("boom"))).toBe(false);
    expect(isChatStreamCloseNoise({ data: { error: "rate_limited" } })).toBe(false);
  });
});
