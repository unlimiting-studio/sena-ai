/**
 * Step-steering handler — concurrency=concurrent + tool-result chunk 를 step 경계 신호로
 * 사용해 mid-tool-call 인터럽트를 회피한다.
 *
 * 새 메시지가 들어오면 즉시 abort 하지 않고 in-flight slot 의 `pendingSteer` 에 적재.
 * 진행 중 turn 의 fullStream tap 이 `tool-result` chunk 를 만나면 그제서야
 * controller.abort() → 같은 핸들러 내부 loop 가 새 컨텍스트로 다음 turn 시작.
 *
 * 도구 호출 없는 짧은 turn 은 step 1개 (turn 끝)라 자연스럽게 큐잉처럼 동작.
 */

import { stepCountIs, streamText } from "ai";
import { isAbortError, isChatStreamCloseNoise } from "../abort.js";
import type { SteeringSlot } from "../steering.js";
import { safePostStream } from "../stream.js";
import { gracefulDrainSkip, type ChatSdkHandler, type HandlerDeps } from "./types.js";
import {
  NO_TEXT_NOTICE,
  buildPromptWithInterrupt,
  getThreadKey,
  hasNoUsableText,
  silenceStreamTextRejections,
  stripLeadingMention,
} from "./utils.js";

const MAX_LOOP_ITERATIONS = 8;

export function createStepSteeringHandler(label: string, deps: HandlerDeps): ChatSdkHandler {
  return async (thread, message) => {
    if (await gracefulDrainSkip(thread, deps.drain)) return;

    if (hasNoUsableText(message.text)) {
      await thread.post(NO_TEXT_NOTICE);
      return;
    }

    const threadKey = getThreadKey(thread);
    const userText = stripLeadingMention(message.text ?? "").trim();

    // codex P1 round 10 — 같은 thread 에 거의 동시에 두 메시지가 들어오면 둘 다 get() 에서
    // undefined 를 보고 각자 새 turn 을 시작하는 race 가 있다. setIfAbsent 로 atomic 하게
    // 첫 슬롯을 등록하고, 두 번째 메시지부터는 pendingSteer 경로로 분기한다 (Map 의 get+set
    // 은 동기 연산이라 microtask boundary 가 끼지 않음).
    const firstController = new AbortController();
    const firstSlot: SteeringSlot = {
      controller: firstController,
      startedAt: Date.now(),
      currentRequest: userText,
      partialText: "",
    };
    const existing = deps.steering.setIfAbsent(threadKey, firstSlot);
    if (existing) {
      existing.pendingSteer = { text: userText, receivedAt: Date.now() };
      deps.log(`[sena] step-steer.queued thread=${threadKey}`);
      try {
        await thread.post("⏸ 다음 step 경계에서 방향 전환할게요. (현재 step 마무리 대기)");
      } catch (err) {
        if (!isChatStreamCloseNoise(err)) throw err;
      }
      return;
    }

    // 본 핸들러가 thread 의 새 turn 주인. firstSlot 은 첫 iteration 이 그대로 사용한다.
    await deps.drain.track(label, async () => {
      // codex P2 round 6 — outer gracefulDrainSkip 후 drain.track 진입 사이에 SIGTERM 이
      // 들어오면 이미 draining=true 인 채로 새 turn loop 가 시작되어 한 응답 길이만큼
      // shutdown 이 지연된다. track 안에서도 다시 한 번 검사한다. 이미 setIfAbsent 로
      // 등록된 firstSlot 도 정리해야 다음 인스턴스가 thread 를 정상 처리할 수 있다.
      if (await gracefulDrainSkip(thread, deps.drain)) {
        deps.steering.releaseIf(threadKey, firstSlot);
        return;
      }

      let currentRequest = userText;
      let interruptedRequest: string | null = null;
      let interruptedPartial: string | null = null;

      for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
        // 첫 iteration 은 setIfAbsent 로 이미 등록된 firstSlot 을 재사용. 이후 iteration 은
        // 새 controller/slot 을 만들고 set() 으로 덮어쓴다 (loop 내부 전이는 자연스럽게 직렬).
        let controller: AbortController;
        let slot: SteeringSlot;
        if (iter === 0) {
          controller = firstController;
          slot = firstSlot;
        } else {
          controller = new AbortController();
          slot = {
            controller,
            startedAt: Date.now(),
            currentRequest,
            partialText: "",
          };
          deps.steering.set(threadKey, slot);
        }

        // codex P1 round 5 — slot 등록 후 streamText/tee 가 동기 throw 하면 slot 이
        // registry 에 영구히 남아 다음 메시지가 모두 pendingSteer 경로로만 빠진다.
        // 초기화 실패 시에도 반드시 slot 정리.
        let result: ReturnType<typeof streamText>;
        let tapStream: ReadableStream<unknown>;
        let postStream: ReadableStream<unknown>;
        try {
          const prompt = buildPromptWithInterrupt({
            current: currentRequest,
            interruptedRequest,
            interruptedPartial,
          });
          result = streamText({
            model: deps.model,
            tools: deps.tools,
            stopWhen: deps.tools ? stepCountIs(deps.maxSteps) : undefined,
            prompt,
            abortSignal: controller.signal,
          });
          // 5/10 회귀 fix — abort 시 background PromiseLike 들이 reject 되어 unhandled
          // rejection 으로 process kill. silent catch 등록.
          silenceStreamTextRejections(result);
          [tapStream, postStream] = result.fullStream.tee();
        } catch (err) {
          deps.steering.releaseIf(threadKey, slot);
          throw err;
        }

        // tap: text-delta 누적 + tool-result chunk(=step 경계) 감지 → pendingSteer 있으면 abort.
        const tap = (async () => {
          const reader = tapStream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) return;
              if (!value || typeof value !== "object") continue;
              const chunk = value as { type?: string; text?: unknown };
              if (chunk.type === "text-delta" && typeof chunk.text === "string") {
                slot.partialText += chunk.text;
              }
              if (chunk.type === "tool-result" && slot.pendingSteer) {
                deps.log(
                  `[sena] step-steer.fire thread=${threadKey} at chunk=tool-result partialChars=${slot.partialText.length}`,
                );
                controller.abort();
                return;
              }
            }
          } catch (err) {
            if (!isAbortError(err)) deps.log(`[sena] step-steer.tap.error ${String(err)}`);
          } finally {
            reader.releaseLock();
          }
        })();

        // codex P1 round 3 — safePostStream/tap 의 예외가 Abort/Noise 가 아니면 throw 되어
        // finally 없이 slot 이 남는다. try/finally 로 감싸서 어떤 경로든 slot 정리.
        let pendingSteer = false;
        try {
          await safePostStream(thread, { fullStream: postStream, text: result.text });
          await tap;
          pendingSteer = Boolean(slot.pendingSteer);
        } catch (err) {
          if (!isAbortError(err) && !isChatStreamCloseNoise(err)) {
            // codex P2 round 7 — provider/adapter 에러로 turn 이 죽었는데 pendingSteer
            // 가 적재돼 있다면, 사용자는 이미 "다음 step 경계에서 전환" 안내를 받은 상태다.
            // 그 약속을 지키기 위해 pendingSteer 를 다음 iteration 으로 흘려보내고, 사용자에게
            // 에러는 별도로 안내한다. pendingSteer 가 없으면 처리할 후속이 없으니 기존처럼 throw.
            if (slot.pendingSteer) {
              // codex P1 round 9 — salvage 경로에서도 기존 streamText/tap 을 명시적으로
              // abort 해야 한다. 그러지 않으면 모델 스트림이 백그라운드로 살아남아 다음
              // iteration 의 새 turn 과 겹쳐 실행 + 토큰/connection leak.
              if (!controller.signal.aborted) controller.abort();
              deps.log(
                `[sena] step-steer.salvage thread=${threadKey} err=${String(err)} → 최신 pendingSteer 로 재시작`,
              );
              try {
                await thread.post(
                  `⚠️ 이전 turn이 오류로 끊겼지만 마지막 요청은 이어서 처리할게요: ${String(err).slice(0, 200)}`,
                );
              } catch (postErr) {
                // codex P1 round 15 — 안내 post 실패가 throw 로 빠져나가면 현재 slot 이
                // releaseIf 없이 registry 에 영구 leak (이후 thread 의 모든 메시지가 pendingSteer
                // 경로로만 쌓임). round 13 패턴처럼 비치명적 로그로 처리하고 다음 iteration 진행.
                deps.log(
                  `[sena] step-steer.salvage.post.failed thread=${threadKey} postErr=${String(postErr)}`,
                );
              }
              pendingSteer = true;
            } else {
              if (!controller.signal.aborted) controller.abort();
              deps.steering.releaseIf(threadKey, slot);
              throw err;
            }
          } else {
            pendingSteer = Boolean(slot.pendingSteer);
          }
        }

        // turn 끝 — pendingSteer 있으면 다음 iteration 으로 새 컨텍스트 반영
        if (pendingSteer && slot.pendingSteer) {
          // codex P2 round 12 — iteration 사이에 SIGTERM 이 들어와 draining=true 가 되면
          // 새 turn 시작은 운영자 기대("현재 turn 만 drain")를 깬다. 사용자에게 안내 후 빠진다.
          if (deps.drain.draining) {
            deps.log(`[sena] step-steer.draining thread=${threadKey} → 다음 turn 미시작`);
            deps.steering.releaseIf(threadKey, slot);
            try {
              await thread.post(
                "⏳ 재시작 중이라 다음 방향 전환은 처리할 수 없어요. 잠시 후 다시 보내주세요.",
              );
            } catch (err) {
              if (!isChatStreamCloseNoise(err)) throw err;
            }
            return;
          }
          interruptedRequest = currentRequest;
          interruptedPartial = slot.partialText.trim() || null;
          currentRequest = slot.pendingSteer.text;
          deps.steering.releaseIf(threadKey, slot);
          try {
            await thread.post(
              `🔄 *step-steering*: step 경계에서 방향 전환합니다 (이전 진행: ${slot.partialText.length}자 누적).`,
            );
          } catch (err) {
            // codex P2 round 13 — 이미 pendingSteer 를 다음 currentRequest 로 승격한 상태라
            // 안내 post 실패가 throw 로 번지면 사용자 정정이 사라진다. 비치명적 로그.
            deps.log(`[sena] step-steer.notice.post.failed thread=${threadKey} err=${String(err)}`);
          }
          continue;
        }

        deps.steering.releaseIf(threadKey, slot);
        return;
      }
      // codex P3 round 5 — MAX_LOOP_ITERATIONS 도달 시 마지막 pendingSteer 가 silent
      // drop 되면 사용자는 자기 정정이 처리됐는지 알 길이 없다. 명시적으로 안내한다.
      deps.log(`[sena] step-steer.loop.exhausted thread=${threadKey}`);
      try {
        await thread.post(
          `⚠️ 연속 방향 전환이 ${MAX_LOOP_ITERATIONS}회를 넘어 이번 turn은 여기서 마무리할게요. 마지막 메시지를 다시 보내주시면 새 turn으로 처리할게요.`,
        );
      } catch (err) {
        if (!isChatStreamCloseNoise(err)) throw err;
      }
    });
  };
}
