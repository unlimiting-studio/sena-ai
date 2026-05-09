/**
 * Queue handler — chat-sdk concurrency=queue 위에서 동작.
 *
 * chat-sdk lock 이 thread 단위로 잡히고, in-flight 중 들어온 메시지가 모이면 가장
 * 최신 메시지가 dispatch 된다. 그 사이 들어온 중간 메시지는 `context.skipped` 로
 * 핸들러에 전달되며, 우리는 prompt 에 흡수해 모델에 전달한다.
 *
 * 인터럽트 없음. PoC 라이브 검증으로 동작 확인됨.
 */

import { streamText } from "ai";
import { safePostStream } from "../stream.js";
import { gracefulDrainSkip, type ChatSdkHandler, type HandlerDeps } from "./types.js";
import { NO_TEXT_NOTICE, buildPromptWithSkipped, stripLeadingMention } from "./utils.js";

export function createQueueHandler(label: string, deps: HandlerDeps): ChatSdkHandler {
  return async (thread, message, context) => {
    await deps.drain.track(label, async () => {
      if (await gracefulDrainSkip(thread, deps.drain)) return;

      // codex P2 round 11 — current text 가 비어 있어도 in-flight 중 들어온 중간 메시지
      // (`context.skipped`) 에는 진짜 의도가 담겨 있을 수 있다(예: 텍스트 정정 후 빈 멘션).
      // skipped 도 비어있을 때만 NO_TEXT_NOTICE 로 종료하고, 한 쪽이라도 텍스트가 있으면
      // buildPromptWithSkipped 에 흡수시켜 모델에 전달한다.
      const userText = stripLeadingMention(message.text ?? "").trim();
      const skippedTexts = (context?.skipped ?? [])
        .map((m) => (m.text ?? "").trim())
        .filter((t) => t.length > 0);

      if (!userText && skippedTexts.length === 0) {
        await thread.post(NO_TEXT_NOTICE);
        return;
      }

      const prompt = buildPromptWithSkipped(userText, context);
      const result = streamText({ model: deps.model, prompt });
      await safePostStream(thread, result);
    });
  };
}
