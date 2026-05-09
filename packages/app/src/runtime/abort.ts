/**
 * AbortController 유틸 — `AbortError` 식별 + abortable sleep.
 */

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "AbortError";
}

/** AbortSignal-aware sleep. signal.abort 발생 시 즉시 reject. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * chat-sdk 부수 발견 #2 — abort 시 `chatStream.stop()`이 `not_authed` 던짐.
 *
 * 새 turn에는 영향 없지만 abort된 stream의 클로즈 처리가 깨끗하지 않음.
 * abort 직후 stream close 처리가 던지는 `not_authed`/`stream_closed` 류
 * non-fatal 에러를 swallow한다.
 */
export function isChatStreamCloseNoise(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const data = (err as { data?: { error?: string } }).data;
  if (data?.error === "not_authed" || data?.error === "stream_closed") return true;
  const message = (err as { message?: string }).message ?? "";
  if (typeof message === "string" && /not_authed|stream[_ ]closed/i.test(message)) return true;
  return false;
}
