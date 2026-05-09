import { describe, it, expect, vi } from "vitest";
import {
  safePostStream,
  type PostableThread,
  type StreamableResult,
} from "../src/runtime/stream.js";

function makeStreamableResult(text: string): StreamableResult {
  return {
    fullStream: (async function* () {
      yield { type: "stream-start" };
      yield { type: "text-delta", text };
      yield { type: "finish" };
    })(),
    text: Promise.resolve(text),
  };
}

describe("safePostStream", () => {
  it("uses fullStream when thread has _currentMessage (normal incoming)", async () => {
    const post = vi.fn(async () => ({}));
    const thread: PostableThread = {
      _currentMessage: { author: { userId: "U123" } },
      post: post as PostableThread["post"],
    };
    await safePostStream(thread, makeStreamableResult("hi"));
    expect(post).toHaveBeenCalledOnce();
    // fullStream(AsyncIterable)이 그대로 넘어가야 한다
    const arg = post.mock.calls[0]?.[0];
    expect(typeof arg).toBe("object");
    expect(typeof (arg as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe("function");
  });

  it("falls back to string post when thread is external reference (no _currentMessage)", async () => {
    const post = vi.fn(async () => ({}));
    const thread: PostableThread = {
      _currentMessage: null,
      post: post as PostableThread["post"],
    };
    await safePostStream(thread, makeStreamableResult("hello"));
    expect(post).toHaveBeenCalledWith("hello");
  });

  // codex P2 회귀 가드 — _currentMessage가 truthy 하더라도 author.userId가 빠진
  // partial shape도 chat-sdk가 깨지는 동일 dereference 경로다. 가드는 셋 다 있어야 통과.
  it("falls back to string post when _currentMessage.author is missing", async () => {
    const post = vi.fn(async () => ({}));
    const thread: PostableThread = {
      _currentMessage: {},
      post: post as PostableThread["post"],
    };
    await safePostStream(thread, makeStreamableResult("hello"));
    expect(post).toHaveBeenCalledWith("hello");
  });

  it("falls back to string post when _currentMessage.author.userId is missing", async () => {
    const post = vi.fn(async () => ({}));
    const thread: PostableThread = {
      _currentMessage: { author: {} },
      post: post as PostableThread["post"],
    };
    await safePostStream(thread, makeStreamableResult("hello"));
    expect(post).toHaveBeenCalledWith("hello");
  });

  it("prepends prefix to string fallback", async () => {
    const post = vi.fn(async () => ({}));
    const thread: PostableThread = {
      _currentMessage: null,
      post: post as PostableThread["post"],
    };
    await safePostStream(thread, makeStreamableResult("body"), {
      prefix: "🕒 cron-triggered turn\n\n",
    });
    expect(post).toHaveBeenCalledWith("🕒 cron-triggered turn\n\nbody");
  });

  it("throws when fallback=throw and thread is external reference", async () => {
    const thread: PostableThread = {
      _currentMessage: null,
      post: vi.fn() as PostableThread["post"],
    };
    await expect(
      safePostStream(thread, makeStreamableResult("x"), { fallback: "throw" }),
    ).rejects.toThrow(/external reference/);
  });
});
