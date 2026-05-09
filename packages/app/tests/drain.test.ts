import { describe, it, expect, vi } from "vitest";
import { createDrainController } from "../src/runtime/drain.js";

describe("createDrainController", () => {
  it("track() increments and decrements inFlight", async () => {
    const drain = createDrainController({ log: () => {} });
    expect(drain.inFlight).toBe(0);

    let observedDuringHandler = -1;
    await drain.track("test", async () => {
      observedDuringHandler = drain.inFlight;
    });

    expect(observedDuringHandler).toBe(1);
    expect(drain.inFlight).toBe(0);
  });

  it("track() decrements inFlight even if handler throws", async () => {
    const drain = createDrainController({ log: () => {} });
    await expect(
      drain.track("boom", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(drain.inFlight).toBe(0);
  });

  it("shutdown() waits for in-flight handler before calling chat.shutdown", async () => {
    const drain = createDrainController({ timeoutMs: 5_000, log: () => {} });
    const chatShutdown = vi.fn(async () => {});
    const chat = { shutdown: chatShutdown };

    let resolveHandler!: () => void;
    const handlerPromise = drain.track("slow", async () => {
      await new Promise<void>((r) => {
        resolveHandler = r;
      });
    });

    // SIGTERM 동시 발생 시뮬
    const shutdownPromise = drain.shutdown(chat);

    // chat.shutdown은 handler 끝나기 전엔 호출되지 않아야 한다
    await new Promise((r) => setTimeout(r, 100));
    expect(chatShutdown).not.toHaveBeenCalled();
    expect(drain.draining).toBe(true);

    // handler 종료 → drain 통과 → chat.shutdown 호출
    resolveHandler();
    await handlerPromise;
    await shutdownPromise;
    expect(chatShutdown).toHaveBeenCalledOnce();
  });

  it("shutdown() forces exit after timeout when handlers are still in-flight", async () => {
    const drain = createDrainController({ timeoutMs: 100, log: () => {} });
    const chatShutdown = vi.fn(async () => {});
    const chat = { shutdown: chatShutdown };

    // 영원히 안 끝나는 handler
    let releaseHandler!: () => void;
    void drain.track("forever", async () => {
      await new Promise<void>((r) => {
        releaseHandler = r;
      });
    });

    const shutdownStart = Date.now();
    await drain.shutdown(chat);
    const elapsed = Date.now() - shutdownStart;

    expect(chatShutdown).toHaveBeenCalledOnce();
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(500);

    // cleanup
    releaseHandler();
  });

  it("shutdown() is idempotent — chat.shutdown only called once", async () => {
    const drain = createDrainController({ timeoutMs: 100, log: () => {} });
    const chatShutdown = vi.fn(async () => {});
    const chat = { shutdown: chatShutdown };

    await drain.shutdown(chat);
    await drain.shutdown(chat);
    await drain.shutdown(chat);

    expect(chatShutdown).toHaveBeenCalledOnce();
  });

  // codex P1 회귀 가드 — 두 번째 SIGTERM 이 첫 drain 완료를 기다리지 않으면
  // process.exit 가 drain 도중 실행되어 graceful shutdown 보장이 깨진다.
  it("shutdown() second call awaits the first drain to complete", async () => {
    const drain = createDrainController({ timeoutMs: 5_000, log: () => {} });
    const order: string[] = [];
    const chatShutdown = vi.fn(async () => {
      // chat.shutdown 도 실제 작업이 좀 걸린다고 가정
      await new Promise((r) => setTimeout(r, 50));
      order.push("chat.shutdown.done");
    });
    const chat = { shutdown: chatShutdown };

    // 영원히 안 끝나는 handler
    let releaseHandler!: () => void;
    void drain.track("forever", async () => {
      await new Promise<void>((r) => {
        releaseHandler = r;
      });
    });

    // 첫 SIGTERM
    const first = drain.shutdown(chat).then(() => order.push("first.resolve"));

    // 두 번째 SIGTERM (예: orchestrator 가 재전송)
    await new Promise((r) => setTimeout(r, 50)); // 첫 호출이 진입했을 시점
    const second = drain.shutdown(chat).then(() => order.push("second.resolve"));

    // handler 끝내기 → drain 통과 → chat.shutdown 호출 → 두 promise 모두 resolve
    setTimeout(() => releaseHandler(), 100);

    await Promise.all([first, second]);

    // 두 번째 shutdown 이 chat.shutdown 끝나기 전에 resolve 되면 안 된다.
    expect(order).toEqual(["chat.shutdown.done", "first.resolve", "second.resolve"]);
    expect(chatShutdown).toHaveBeenCalledOnce();
  });
});
