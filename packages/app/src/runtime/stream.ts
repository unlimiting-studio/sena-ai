/**
 * 외부 reference stream wrapper — chat-sdk 부수 발견 #1 보완.
 *
 * 부수 발견 #1 (`chat/dist/index.js:1631`): `chat.thread(threadId)`로 만든 외부 reference에서
 * `thread.post(stream)`을 호출하면 `_currentMessage.author.userId` undefined dereference로
 * 깨진다 (incoming message 없이 트리거된 thread는 `_currentMessage`가 null).
 *
 * cron 발화·외부 트리거 시나리오에서 streaming 출력이 필요한 경우, 이 wrapper가
 * 안전 경로(text 누적 후 string post)로 fallback 한다. 단, 이 우회는 **streaming 미리보기를
 * 잃는다** — 본 마이그 시점에 chat-sdk upstream PR로 native 지원을 받는 게 정답이고,
 * 여기서는 fail-soft 형태로만 제공.
 *
 * 사용:
 * ```ts
 * const result = streamText({ model, prompt });
 * await safePostStream(thread, result, { fallback: "string" });
 * ```
 *
 * `fallback: "string"` (기본): incoming message 없는 thread에서는 `result.text`를 await 후
 *   `thread.post(string)`. streaming 미리보기 없음.
 * `fallback: "throw"`: 깨질 가능성 있는 시나리오에서 명시적으로 에러를 던짐 (디버깅용).
 */

/** 우리가 다루는 thread 인터페이스의 최소 표면. chat-sdk Thread 구조 위에서 동작 */
export interface PostableThread {
  /** chat-sdk Thread는 `_currentMessage`를 internal property로 갖는다 (undefined일 수 있음) */
  readonly _currentMessage?: { author?: { userId?: string } } | null;
  post(message: string): Promise<unknown>;
  // ReadableStream은 `Symbol.asyncIterator`를 구현하므로 chat-sdk의 AsyncIterable 시그니처와 호환.
  post(stream: AsyncIterable<unknown> | ReadableStream<unknown>): Promise<unknown>;
}

/**
 * ai-sdk `streamText` 결과에서 본 wrapper가 실제로 사용하는 표면만 좁힌 인터페이스.
 * (`ai`의 구체 `StreamTextResult` 제네릭은 ToolSet/Output 제약이 까다로워 직접 import하지 않는다.)
 *
 * - `fullStream`: ai-sdk는 `ReadableStream<...>`을 반환. 본 wrapper는 chat-sdk thread.post로
 *   그대로 forward하므로 `unknown`으로 좁히지 않고 `ReadableStream<unknown>` 또는
 *   `AsyncIterable<unknown>` 둘 다 받는 형태로 둔다.
 * - `text`: ai-sdk `result.text`는 `PromiseLike<string>` (Promise 인터페이스 일부만 노출).
 */
export interface StreamableResult {
  readonly fullStream: ReadableStream<unknown> | AsyncIterable<unknown>;
  readonly text: PromiseLike<string>;
}

export interface SafePostStreamOptions {
  /** 외부 reference로 streaming 불가 시 동작 (기본 `string`) */
  fallback?: "string" | "throw";
  /** prefix를 string post 앞에 붙임 (예: `🕒 cron-triggered turn\n\n`) */
  prefix?: string;
}

export async function safePostStream(
  thread: PostableThread,
  result: StreamableResult,
  options: SafePostStreamOptions = {},
): Promise<void> {
  const fallback = options.fallback ?? "string";

  // chat-sdk가 깨지는 정확한 라인이 `_currentMessage.author.userId` 역참조이므로
  // (chat/dist/index.js:1631), `_currentMessage`가 truthy여도 `author` 또는 `userId`가
  // 비어 있으면 동일하게 깨진다. 셋 다 채워져 있어야만 streaming 경로 안전 (codex P2).
  const canStream = Boolean(thread._currentMessage?.author?.userId);

  if (canStream) {
    // 정상 경로 — incoming message 컨텍스트 있음. chat-sdk가 streaming을 자체 처리.
    await thread.post(result.fullStream);
    return;
  }

  if (fallback === "throw") {
    throw new Error(
      "[@sena-ai/app] safePostStream: thread missing _currentMessage.author.userId " +
        "(external reference or partial author). chat-sdk Thread.handleStream is broken " +
        "on this shape (chat/dist/index.js:1631). Use { fallback: 'string' } to fall back.",
    );
  }

  // fallback="string": text 누적 후 string post
  const text = await result.text;
  const body = options.prefix ? `${options.prefix}${text}` : text;
  await thread.post(body);
}
