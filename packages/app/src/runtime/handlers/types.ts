/**
 * Handler 공용 타입 — chat-sdk Thread/Message 구체 타입에 깊이 의존하지 않도록
 * 핸들러가 실제 사용하는 표면만 좁힌 인터페이스로 노출한다. (`chat`/`@chat-adapter/slack`
 * 의 generic 시그니처를 그대로 전파하면 type assertion 지옥이라 추상화)
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { DrainController } from "../drain.js";
import type { SteeringRegistry } from "../steering.js";
import type { SkippedContext } from "./utils.js";

/** 우리가 다루는 thread 의 최소 표면 (chat-sdk Thread 위에서 동작) */
export interface HandlerThread {
  /** chat-sdk 가 author dereference 시 사용하는 internal property */
  readonly _currentMessage?: { author?: { userId?: string } } | null;
  readonly id?: string;
  readonly threadId?: string;
  subscribe(): Promise<void>;
  post(message: string): Promise<unknown>;
  post(stream: AsyncIterable<unknown>): Promise<unknown>;
}

export interface HandlerMessage {
  readonly text?: string;
}

/** chat-sdk handler 시그니처와 호환 */
export type ChatSdkHandler = (
  thread: HandlerThread,
  message: HandlerMessage,
  context?: SkippedContext,
) => Promise<void>;

export interface HandlerDeps {
  /** ai-sdk wrapped model (middleware 체인 적용된 후) */
  model: LanguageModelV3;
  drain: DrainController;
  steering: SteeringRegistry;
  /** 핸들러 안에서 진행 상황 로깅 (기본 console.log) */
  log: (message: string) => void;
}

/**
 * drain 시 우아하게 빠지기 — 사용자에게 안내 메시지 후 return.
 *
 * codex P1 round 9 — Slack/chat-sdk 이벤트는 한 번 소비되면 재시작한 인스턴스로
 * 자동 재전달되지 않는다. "다음 인스턴스가 받을게요" 라고 약속하면 운영자가 유실을
 * 알아채지 못하므로, 실제 동작 그대로(이번 요청은 드롭, 다시 보내달라)를 안내한다.
 */
export async function gracefulDrainSkip(
  thread: HandlerThread,
  drain: DrainController,
): Promise<boolean> {
  if (!drain.draining) return false;
  try {
    await thread.post(
      "⏳ 재시작 중이라 이번 메시지는 처리할 수 없어요. 잠시 후 다시 보내주세요.",
    );
  } catch {
    // adapter 가 이미 disconnect 됐을 수 있음 — silent
  }
  return true;
}
