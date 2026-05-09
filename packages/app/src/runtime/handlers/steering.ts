/**
 * Immediate steering handler — chat-sdk concurrency=concurrent 위에서 thread-local
 * AbortController 로 진행 중 turn 을 즉시 중단하고 새 컨텍스트로 재시작한다.
 *
 * PoC 라이브 검증 결과:
 * - turn.start → 20s 후 새 메시지 → controller.abort() → ai-sdk streamText 가
 *   AbortError 마감 → 같은 thread 에 새 controller + 새 turn
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
  stripLeadingMention,
  tapTextDelta,
} from "./utils.js";

export function createSteeringHandler(label: string, deps: HandlerDeps): ChatSdkHandler {
  return async (thread, message) => {
    if (await gracefulDrainSkip(thread, deps.drain)) return;

    if (hasNoUsableText(message.text)) {
      await thread.post(NO_TEXT_NOTICE);
      return;
    }

    const threadKey = getThreadKey(thread);
    const userText = stripLeadingMention(message.text ?? "").trim();

    await deps.drain.track(label, async () => {
      // codex P2 round 6 — outer gracefulDrainSkip 와 drain.track 사이에 SIGTERM 이 들어오면
      // 이미 draining=true 인 채로 새 turn 이 진입하므로, track 안에서도 한 번 더 검사한다.
      // 여기서 빠지면 slot 도 등록되지 않은 상태라 정리 부담 없음.
      if (await gracefulDrainSkip(thread, deps.drain)) return;

      // codex P1 round 4 — 동일 thread 에 연속 mention 이 오면 abort 후 set 전 짧은
      // 창에 다른 핸들러가 끼어들어 turn 순서가 역전될 수 있다. 새 slot 을 *먼저* 만들고
      // get + set 을 atomic 하게 묶은 뒤 prev 를 abort 한다. (Map 의 set 은 동기이므로
      // 이 sequence 는 다른 async 핸들러가 끼어들 틈이 없다.)
      const controller = new AbortController();
      const slot: SteeringSlot = {
        controller,
        startedAt: Date.now(),
        currentRequest: userText,
        partialText: "",
      };
      const prev = deps.steering.get(threadKey);
      deps.steering.set(threadKey, slot);

      // codex P2 round 6 — set 이후의 모든 분기는 반드시 finally 의 releaseIf 를 통과해야
      // 한다. 그렇지 않으면 thread.post 실패 등으로 slot 이 영구 leak 되어 같은 thread 가
      // "진행 중 turn 있음" 으로 잘못 판단되어 갇힌다.
      let interruptedRequest: string | null = null;
      let interruptedPartial: string | null = null;
      try {
        if (prev) {
          interruptedRequest = prev.currentRequest;
          interruptedPartial = prev.partialText.trim() || null;
          const elapsedMs = Date.now() - prev.startedAt;
          deps.log(
            `[sena] steering.interrupt thread=${threadKey} elapsedMs=${elapsedMs} partialChars=${prev.partialText.length}`,
          );
          prev.controller.abort();
          // 이전 핸들러 finally 정리 시간을 살짝 양보 (slot 은 이미 우리 것이라 race 없음).
          await new Promise((r) => setTimeout(r, 50));
          try {
            await thread.post(
              `🔄 *steering*: 이전 요청 끊고 방향 전환합니다 (이전 진행: ${elapsedMs}ms, ${prev.partialText.length}자 누적).`,
            );
          } catch (err) {
            // 부수 발견 #2 — abort 직후 stream stop 은 not_authed 던질 수 있음. swallow.
            // codex P2 round 13 — rate limit·네트워크 같은 일반 post 실패도 *상태 안내일 뿐*
            // 이므로 throw 하면 실제 사용자 새 요청까지 통째로 유실된다. 로그만 남기고 진행.
            deps.log(`[sena] steering.notice.post.failed thread=${threadKey} err=${String(err)}`);
          }
        }

        const prompt = buildPromptWithInterrupt({
          current: userText,
          interruptedRequest,
          interruptedPartial,
        });
        const result = streamText({
          model: deps.model,
          tools: deps.tools,
          stopWhen: deps.tools ? stepCountIs(deps.maxSteps) : undefined,
          prompt,
          abortSignal: controller.signal,
        });

        // partialText 누적 — fullStream을 두 갈래로 분기
        const [tapStream, postStream] = result.fullStream.tee();
        void tapTextDelta(
          tapStream,
          (delta) => {
            slot.partialText += delta;
          },
          (err) => {
            if (!isAbortError(err)) deps.log(`[sena] steering.tap.error ${String(err)}`);
          },
        );

        await safePostStream(thread, { fullStream: postStream, text: result.text });
      } catch (err) {
        if (isAbortError(err)) {
          deps.log(`[sena] turn aborted thread=${threadKey}`);
        } else if (isChatStreamCloseNoise(err)) {
          // 부수 발견 #2 — thread.post 도중 abort 영향으로 stream close 에러
          deps.log(`[sena] stream close noise swallowed thread=${threadKey}`);
        } else {
          // codex P1 round 7 — safePostStream 등이 정상 에러로 실패해도 tapTextDelta 가
          // tee 한 다른 갈래를 계속 읽고 있어 모델 스트림이 백그라운드로 살아남는다.
          // controller.abort() 로 명시적으로 streamText 를 중단시켜 토큰/connection leak 차단.
          if (!controller.signal.aborted) controller.abort();
          throw err;
        }
      } finally {
        // tap 이 아직 살아 있을 수 있으므로(완료 전 throw) 여기서도 한 번 더 abort 보장.
        if (!controller.signal.aborted) controller.abort();
        deps.steering.releaseIf(threadKey, slot);
      }
    });
  };
}
