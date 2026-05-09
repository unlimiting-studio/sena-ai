/**
 * 앱 entry — `defineConfig`로 받은 설정을 실제 chat-sdk Chat 인스턴스 + middleware
 * chain + drain wrapper + steering 레이어로 통합한다.
 *
 * `sena.config.ts` 한 파일 + `run(defineConfig({...}))` 한 번 호출이면 베어본
 * 에이전트가 동작한다 (PoC `~/agents/sena-poc/src/index.ts`의 모든 인프라를 통합).
 *
 * 통합 항목:
 *  - chat-sdk Chat 인스턴스 (adapters · state · concurrency)
 *  - ai-sdk wrapLanguageModel (middleware 체인)
 *  - drain wrapper (`Chat.shutdown` drain 부재 보완)
 *  - steering 레이어 (chat-sdk 에 없는 thread-local AbortController 인터럽트)
 *  - signal handler 자동 등록 (옵셔널)
 *  - cron schedule fan-out (옵셔널, schedules 배열에서 트리거)
 */

import { wrapLanguageModel } from "ai";
import { Chat, type Adapter } from "chat";
import type { SenaConfig } from "../config.js";
import { createDrainController, type DrainController } from "./drain.js";
import { createQueueHandler } from "./handlers/queue.js";
import { createStepSteeringHandler } from "./handlers/step.js";
import { createSteeringHandler } from "./handlers/steering.js";
import type { ChatSdkHandler, HandlerDeps } from "./handlers/types.js";
import { SteeringRegistry } from "./steering.js";

export type SteeringMode = "queue" | "steering" | "step-steering";

export interface RunOptions {
  /** SIGTERM 받았을 때 in-flight turn 드레인 timeout (기본 60s) */
  drainTimeoutMs?: number;
  /** drain/handler 진행 상황 로깅 (기본 console.log) */
  log?: (message: string) => void;
  /**
   * 인터럽트 모드 (기본 'steering' = 즉시 abort).
   * - 'queue': chat-sdk concurrency=queue + drainQueue (인터럽트 없음)
   * - 'steering': concurrency=concurrent + 즉시 abort + 새 컨텍스트 재시작
   * - 'step-steering': concurrency=concurrent + tool-result chunk 경계에서 abort
   */
  steerMode?: SteeringMode;
  /** chat-sdk userName (default 'sena') */
  userName?: string;
  /**
   * SIGTERM/SIGINT 자동 등록 (default true).
   * 자동 등록되더라도 *drain까지만* 호출하고 `process.exit()`은 호출하지 않는다 — DB pool /
   * HTTP server / metrics flush 등 호출자 측 정리 코드가 남았을 수 있기 때문이다.
   * 호출자가 drain 후 즉시 종료하길 원하면 본 옵션을 false로 두고 본인이 시그널 핸들러에
   * `await app.shutdown(); process.exit(0)` 를 직접 박는다.
   */
  autoRegisterSignalHandlers?: boolean;
  /**
   * steering/step-steering 모드의 thread 당 chat-sdk 동시 핸들러 상한
   * (chat-sdk concurrency=concurrent maxConcurrent). 미지정 시 chat-sdk 기본값(Infinity).
   * 이 상한이 너무 낮으면 steering semantics 가 깨진다 — 9번째 mention 이후가 chat-sdk
   * waiter 큐에 막혀서 우리 abort 로직에 진입조차 못 하기 때문 (codex P2 round 8).
   */
  maxConcurrentPerThread?: number;
}

export interface RunningApp {
  readonly chat: Chat;
  readonly drain: DrainController;
  readonly steering: SteeringRegistry;
  /** drain → chat.shutdown. process.exit는 호출자 책임 (drain.ts JSDoc 참조). */
  shutdown(): Promise<void>;
}

export async function run(config: SenaConfig, options: RunOptions = {}): Promise<RunningApp> {
  const log = options.log ?? ((m) => console.log(m));
  const steerMode = options.steerMode ?? "steering";

  // 0. fail-fast — 미구현 기능이 설정에 들어있으면 silent 실패 대신 명시적으로 throw.
  // schedules 통합은 본 마이그 §1 step 4 예정. step 3에서는 cronSchedule() factory가
  // spec 시그니처만 노출하고, run() 시점에 실제 트리거는 등록되지 않는다.
  if (config.schedules.length > 0) {
    throw new Error(
      "[@sena-ai/app] schedules fan-out not implemented yet (본 마이그 §1 step 4 예정). " +
        `${config.schedules.length}개 schedule이 SenaConfig에 들어있지만 트리거가 등록되지 않는다. ` +
        "임시로는 schedules: [] 로 두거나, 호출자가 직접 chat.thread()/streamText로 cron을 구현.",
    );
  }
  // codex P1 round 14 — mcpServers 도 schedules 와 동일하게 step 3 시점엔 모델에 실제로
  // 연결되지 않는다. silent 무시는 운영자가 "도구가 안 붙는 이유" 를 찾기 매우 어렵게 하므로
  // schedules 와 동일한 fail-fast 로 본 미구현을 명시한다 (step 4+ 에서 provider 옵션 병합).
  const mcpServerNames = config.mcpServers ? Object.keys(config.mcpServers) : [];
  if (mcpServerNames.length > 0) {
    throw new Error(
      "[@sena-ai/app] mcpServers integration not implemented yet (본 마이그 §1 step 4+ 예정). " +
        `${mcpServerNames.length}개 MCP 서버(${mcpServerNames.join(",")})가 SenaConfig에 들어있지만 모델에 연결되지 않는다. ` +
        "임시로는 mcpServers 를 빼거나, 호출자가 모델 인스턴스에 직접 mcp 옵션을 병합.",
    );
  }
  // codex P2 round 14 — 어댑터 0개면 chat-sdk 가 어떤 이벤트도 받지 못해 앱이 사실상 죽은 상태로
  // 시작된다. 운영자가 원인 파악 못 하는 silent 회귀이므로 fail-fast.
  if (config.adapters.length === 0) {
    throw new Error(
      "[@sena-ai/app] config.adapters 가 비어 있다. 1개 이상의 adapter (예: slackAdapter) 를 등록해라.",
    );
  }

  // 1. chat-sdk concurrency 결정 — queue 만 lock, 그 외는 concurrent (우리 steering 위임).
  // codex P2 round 8 — concurrent 모드에서 maxConcurrent 를 8 처럼 작게 박으면 steering 의
  // 핵심 가정(새 mention 즉시 abort)이 깨진다(9번째부터 chat-sdk waiter 큐에 갇혀 핸들러 진입
  // 자체를 못 함). 기본은 chat-sdk 의 Infinity 를 그대로 사용하고, 호출자가 운영상 상한이 필요하면
  // RunOptions.maxConcurrentPerThread 로 명시적으로 지정한다.
  const chatConcurrency =
    steerMode === "queue"
      ? ({ strategy: "queue" as const, maxQueueSize: 10 } as const)
      : options.maxConcurrentPerThread !== undefined
        ? ({
            strategy: "concurrent" as const,
            maxConcurrent: options.maxConcurrentPerThread,
          } as const)
        : ({ strategy: "concurrent" as const } as const);

  // 2. ai-sdk middleware chain
  const wrappedModel =
    config.middlewares.length > 0
      ? wrapLanguageModel({ model: config.model, middleware: config.middlewares })
      : config.model;

  // 3. adapters: 배열 → record (chat-sdk ChatConfig.adapters 형태). adapter.name 키 사용.
  const adapterRecord: Record<string, Adapter> = {};
  for (const adapter of config.adapters as Adapter[]) {
    if (adapterRecord[adapter.name]) {
      throw new Error(
        `[@sena-ai/app] duplicate adapter name "${adapter.name}". 어댑터 이름은 고유해야 한다.`,
      );
    }
    adapterRecord[adapter.name] = adapter;
  }

  // 4. Chat 인스턴스
  const chat = new Chat({
    userName: options.userName ?? "sena",
    state: config.state as unknown as ConstructorParameters<typeof Chat>[0]["state"],
    concurrency: chatConcurrency,
    adapters: adapterRecord,
    logger: "info",
  });

  log(`[sena] init steerMode=${steerMode} adapters=${Object.keys(adapterRecord).join(",")}`);

  // 5. drain + steering 인프라
  const drain = createDrainController({ timeoutMs: options.drainTimeoutMs, log });
  const steering = new SteeringRegistry();

  const handlerDeps: HandlerDeps = { model: wrappedModel, drain, steering, log };

  const makeHandler = (label: string): ChatSdkHandler => {
    if (steerMode === "queue") return createQueueHandler(label, handlerDeps);
    if (steerMode === "step-steering") return createStepSteeringHandler(label, handlerDeps);
    return createSteeringHandler(label, handlerDeps);
  };

  // 6. handler 등록 — chat-sdk Thread/Message 구체 generic을 우리 HandlerThread/HandlerMessage로
  //    수렴시키기 위해 unknown 경유 cast (chat-sdk 시그니처는 우리가 좁힌 표면을 만족).
  const onMention = makeHandler("onNewMention");
  const onMessage = makeHandler("onSubscribedMessage");

  chat.onNewMention(async (thread, message, context) => {
    // drain 중엔 subscribe 전에 graceful skip — 새 인스턴스가 다시 onNewMention 받게 (codex P2 round 3)
    if (drain.draining) {
      try {
        await thread.post(
          "⏳ 재시작 중이라 이번 메시지는 처리할 수 없어요. 잠시 후 다시 보내주세요.",
        );
      } catch {
        // socket 끊김 등 silent
      }
      return;
    }

    // codex P1 round 6 — *먼저* subscribe 한다. 첫 응답이 진행되는 동안 사용자가 보낸
    // 정정/추가 메시지가 onSubscribedMessage 로 라우팅되어야 steering/step-steering 이
    // 첫 turn 부터 동작한다. 핸들러가 throw 하면 unsubscribe 해서 다음 mention 이 다시
    // onNewMention 으로 정상 진입하게 한다 (round 5 의 "실패 시 정상 복구" 의도 보존).
    //
    // codex P1 round 8 — subscribe 실패 시 silent log+계속 진행하면 첫 답변은 가지만 후속
    // 메시지가 unsubscribed 경로에 남아 non-mention 유실 + steering 미동작. fail-fast 로
    // 본 turn 자체를 throw 시켜서 chat-sdk 가 다음 mention 을 정상 onNewMention 으로 다시
    // 보내게 한다 (단발성 DB 장애가 영구 라우팅 깨짐으로 번지지 않게).
    //
    // codex P1 round 11 — subscribe + onMention 전체를 drain.track 으로 감싸야 첫 멘션 처리
    // 도중 SIGTERM 이 들어와도 drain 이 inFlight 로 인식하고 chat.shutdown 이전에 끝나길
    // 기다린다. 핸들러 내부의 drain.track 과 nested 되지만, 카운터만 +1/-1 두 번이라 무해.
    await drain.track("onNewMention", async () => {
      await thread.subscribe();
      let success = false;
      try {
        await onMention(
          thread as unknown as Parameters<ChatSdkHandler>[0],
          message as unknown as Parameters<ChatSdkHandler>[1],
          context as unknown as Parameters<ChatSdkHandler>[2],
        );
        success = true;
      } finally {
        if (!success) {
          try {
            await thread.unsubscribe();
          } catch (err) {
            log(`[sena] unsubscribe-after-failure failed: ${String(err)}`);
          }
        }
      }
    });
  });
  chat.onSubscribedMessage(async (thread, message, context) => {
    // text 없는 첨부 전용 메시지도 핸들러로 위임 (codex P2 round 2). 핸들러는
    // 첨부 처리가 미구현이면 사용자에게 안내 응답을 한 번 보내고 turn 종료하므로
    // silent drop 회피.
    //
    // codex P1 round 12 — onNewMention 과 마찬가지로 subscribed-thread 핸들러도
    // drain.track 으로 감싸야 follow-up 메시지 처리 도중 SIGTERM 으로 chat.shutdown 이
    // inFlight=0 으로 잘못 판단해 한가운데서 connection 을 끊는 회귀를 막을 수 있다.
    await drain.track("onSubscribedMessage", async () => {
      await onMessage(
        thread as unknown as Parameters<ChatSdkHandler>[0],
        message as unknown as Parameters<ChatSdkHandler>[1],
        context as unknown as Parameters<ChatSdkHandler>[2],
      );
    });
  });

  // 7. initialize (어댑터 connect, state schema 생성 등)
  await chat.initialize();
  log("[sena] initialized");

  // 8. signal handler — 자동 등록 시에도 *drain + steering 정리까지만*.
  // process.exit 은 호출자 책임 (라이브러리로 임베드된 프로세스 보호).
  // codex P3 round 4 — 한 프로세스에서 run() 이 여러 번 호출될 수 있는 환경(테스트, 핫리로드)을
  // 위해 등록한 listener 를 shutdown 시점에 명시적으로 해제한다. MaxListenersExceededWarning 회피.
  const sigtermListener = (): void => onSignal("SIGTERM");
  const sigintListener = (): void => onSignal("SIGINT");
  const autoSignals = options.autoRegisterSignalHandlers !== false;

  // shutdown 한 번만 실행되도록 가드 (signal 두 번 와도 같은 promise share)
  let shutdownPromise: Promise<void> | null = null;
  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      // 순서 중요 (codex P2 round 1): 먼저 drain → 그 후 steering.clear (잔여 AbortController 정리).
      await drain.shutdown(chat);
      steering.clear();
      if (autoSignals) {
        process.removeListener("SIGTERM", sigtermListener);
        process.removeListener("SIGINT", sigintListener);
      }
    })();
    return shutdownPromise;
  };

  function onSignal(signal: string): void {
    log(`[sena] received ${signal} — draining (process.exit은 호출자 책임)`);
    void shutdown().catch((err) => {
      log(`[sena] shutdown error: ${String(err)}`);
    });
  }

  if (autoSignals) {
    process.on("SIGTERM", sigtermListener);
    process.on("SIGINT", sigintListener);
  }

  return {
    chat,
    drain,
    steering,
    shutdown,
  };
}
