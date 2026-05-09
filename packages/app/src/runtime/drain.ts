/**
 * Drain wrapper — chat-sdk `Chat.shutdown()` drain 부재 보완.
 *
 * 부수 발견 #3 (`chat/dist/index.js:2454-2476`): chat-sdk shutdown은 어댑터/state
 * disconnect만 하고 in-flight 핸들러를 추적/대기하지 않는다. SIGTERM 받으면 우리가
 * inFlight=0 될 때까지 기다린 뒤 chat.shutdown 까지 호출한다.
 *
 * **책임 범위:** 이 wrapper는 in-flight 핸들러 드레인 + `chat.shutdown()` 까지다.
 * `process.exit()` 호출은 의도적으로 빼두었다 — 호출자(베어본 에이전트의 main)가
 * 다른 리소스(타이머·DB pool·socket 등) 정리 책임을 마저 진 뒤 직접 exit한다.
 * 단순 사용자는 `process.on("SIGTERM", () => drain.shutdown(chat).then(() => process.exit(0)))`
 * 형태로 명시적으로 exit를 붙이면 된다.
 *
 * 사용:
 * ```ts
 * const drain = createDrainController({ timeoutMs: 60_000 });
 * chat.onNewMention(async (thread, message) => {
 *   await drain.track("onNewMention", async () => {
 *     if (drain.draining) return; // 우아하게 스킵
 *     // ... handler body
 *   });
 * });
 * process.on("SIGTERM", () => drain.shutdown(chat).then(() => process.exit(0)));
 * ```
 *
 * PoC `sena-poc/src/index.ts` 이전. PoC 라이브 검증 결과:
 * - SIGTERM at t=3s during 15s synthetic turn → draining flag 플립, 그러나 turn은
 *   15001ms 끝까지 진행 후 정상 exit (drain-test.ts).
 */

export interface DrainControllerOptions {
  /** drain timeout (기본 60s). 그 이후엔 강제 shutdown. */
  timeoutMs?: number;
  /** drain 진행 상황 로깅용 (기본 console.log). */
  log?: (message: string) => void;
}

export interface DrainController {
  /** 현재 in-flight 핸들러 수 */
  readonly inFlight: number;
  /** SIGTERM 받았는지. 핸들러는 이 플래그를 보고 빠르게 빠져야 한다. */
  readonly draining: boolean;

  /** 핸들러 실행을 inFlight 카운터로 감싼다. */
  track<T>(label: string, fn: () => Promise<T>): Promise<T>;

  /** SIGTERM 처리 — draining 플래그 + inFlight=0 대기 + chat.shutdown + exit. */
  shutdown(chat: { shutdown(): Promise<void> }): Promise<void>;
}

export function createDrainController(options: DrainControllerOptions = {}): DrainController {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const log = options.log ?? ((m) => console.log(m));

  let inFlight = 0;
  let draining = false;
  let shutdownPromise: Promise<void> | null = null;

  return {
    get inFlight() {
      return inFlight;
    },
    get draining() {
      return draining;
    },

    async track<T>(label: string, fn: () => Promise<T>): Promise<T> {
      inFlight += 1;
      log(`[sena] turn.enter label=${label} inFlight=${inFlight}`);
      try {
        return await fn();
      } finally {
        inFlight -= 1;
        log(`[sena] turn.exit label=${label} inFlight=${inFlight}`);
      }
    },

    async shutdown(chat) {
      // Idempotent: 첫 호출의 promise를 모두 공유한다. 두 번째 SIGTERM·SIGINT 가
      // 도착하더라도 첫 drain + chat.shutdown 이 끝날 때까지 await 한다.
      // 이전 구현은 두 번째 호출이 즉시 resolve 되어 process.exit 가 drain 도중
      // 실행될 위험이 있었다 (codex P1, fail-fast 위반).
      if (shutdownPromise) return shutdownPromise;

      shutdownPromise = (async () => {
        log(`[sena] shutdown signal received, draining... inFlight=${inFlight}`);
        draining = true;

        const drainStart = Date.now();
        while (inFlight > 0) {
          if (Date.now() - drainStart > timeoutMs) {
            log(
              `[sena] drain timeout after ${timeoutMs}ms, ${inFlight} turns still in flight; forcing shutdown`,
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        log(`[sena] drain done after ${Date.now() - drainStart}ms (inFlight=${inFlight})`);
        await chat.shutdown();
      })();

      return shutdownPromise;
    },
  };
}
