/**
 * Handler 공용 유틸 — Slack 멘션 strip, thread key, prompt 합성, partial text tap.
 *
 * PoC `~/agents/sena-poc/src/index.ts` 의 헬퍼들을 패키지 모듈로 추출.
 */

/** Slack 멘션 prefix(`<@Uxxx>`)만 제거. 어댑터별 mention 토큰 차이는 향후 확장. */
export function stripLeadingMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/, "");
}

/**
 * 본 마이그 §1 step 3 — 텍스트가 비어 있는 메시지(첨부만, 멘션만, 공백만 등) 처리.
 *
 * codex P2 round 10 — 이전엔 이 함수가 "attachment-only" 라고 자칭했지만 실제로는 첨부 유무를
 * 확인하지 않고 stripLeadingMention 후 trim 결과만 검사한다. 그래서 사용자가 `<@bot>` 처럼
 * 멘션만 보내거나 공백 메시지를 보내도 "첨부 파일을 받았어요" 안내가 나가는 회귀가 있었다.
 * 이름과 안내 문구를 실제 동작(텍스트 없음)에 맞춘다. attachment-aware 처리는 step 4+ 에서.
 *
 * @returns 본 메시지가 처리할 텍스트가 없으면 true → 핸들러는 안내 응답 후 즉시 turn 종료.
 */
export function hasNoUsableText(rawText: string | undefined): boolean {
  return !stripLeadingMention(rawText ?? "").trim();
}

/** 텍스트 없는 메시지에 보낼 안내 응답 (어댑터 무관, 한국어 톤). */
export const NO_TEXT_NOTICE =
  "💬 처리할 텍스트가 없어요. 원하는 내용을 한 줄로 적어 다시 보내주세요. " +
  "(첨부 파일은 아직 받지 못해요 — step 4+ 에서 추가 예정.)";

/** chat-sdk Thread 의 thread id를 안전하게 추출 (어댑터마다 키 이름 차이 흡수). */
export function getThreadKey(thread: { id?: string; threadId?: string }): string {
  return thread.threadId ?? thread.id ?? "unknown";
}

/**
 * Queue 모드 — chat-sdk가 in-flight 중 들어온 메시지를 모아서 가장 최신만 dispatch하고
 * 중간 메시지를 `context.skipped`로 핸들러에 전달한다. 그걸 prompt에 흡수해 모델이
 * "사용자가 N개 더 보냈고 마지막이 메인 요구"임을 알게 한다 (PoC 라이브 검증 동작).
 */
export interface SkippedContext {
  skipped?: Array<{ text?: string }>;
  totalSinceLastHandler?: number;
}

export function buildPromptWithSkipped(current: string, context: SkippedContext | undefined): string {
  if (!context?.skipped?.length) return current;
  // codex P2 round 4 — `아냐` `취소` `네` 같은 짧은 정정/취소 메시지가 가장 의도 큰 신호일
  // 수 있으므로 길이 필터 없이 전부 보존한다. 빈 문자열만 제외 (텍스트 없는 첨부 메시지).
  //
  // codex P2 round 12 — current 가 비어 있는데 (예: 빈 멘션이 마지막) skipped 만 텍스트가 있을
  // 때 prompt 가 "최신(이게 메인 요구): {empty}" 로 나가면 모델이 빈 메시지를 메인으로 받아
  // skipped 의 진짜 의도를 무시한다. 이 경우 마지막 비어있지 않은 skipped 를 메인으로 끌어올린다.
  const trimmedCurrent = current.trim();
  const allTexts = context.skipped
    .map((m) => m.text?.trim() ?? "")
    .filter((t) => t.length > 0);
  let mainText = trimmedCurrent;
  let middleEntries = context.skipped;
  if (!trimmedCurrent && allTexts.length > 0) {
    mainText = allTexts[allTexts.length - 1] ?? "";
    // 마지막 비어있지 않은 항목만 메인으로 빼고 나머지는 중간 메시지로.
    let lastNonEmpty = -1;
    for (let i = context.skipped.length - 1; i >= 0; i--) {
      if ((context.skipped[i]?.text ?? "").trim().length > 0) {
        lastNonEmpty = i;
        break;
      }
    }
    middleEntries = context.skipped.filter((_, i) => i !== lastNonEmpty);
  }
  const skippedTexts = middleEntries
    .map((m, i) => {
      const text = m.text?.trim() ?? "";
      return text ? `(${i + 1}) ${text}` : `(${i + 1}) (텍스트 없는 첨부)`;
    })
    .join("\n");
  const totalCount = context.totalSinceLastHandler ?? context.skipped.length + 1;
  return [
    `사용자가 이전 turn 진행 중에 다음 ${totalCount}개 메시지를 보냈고 마지막에 있는 의미 있는 메시지가 메인 요구예요.`,
    middleEntries.length > 0 ? "중간 메시지(생략하지 말고 흐름은 반영):" : "",
    skippedTexts,
    "",
    "최신(이게 메인 요구):",
    mainText,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");
}

/**
 * Steering — 진행 중 turn을 abort 한 직후, 모델에 "이전 요청 [X]를 처리하다 인터럽트
 * 됐고 새 요구 [Y]를 우선 처리해" 컨텍스트를 prompt 앞에 박는다.
 */
export function buildPromptWithInterrupt(args: {
  current: string;
  interruptedRequest?: string | null;
  interruptedPartial?: string | null;
}): string {
  const { current, interruptedRequest, interruptedPartial } = args;
  if (!interruptedRequest) return current;
  const parts: string[] = [
    `직전에 사용자가 "${interruptedRequest}" 요청을 했고 답변을 진행 중이었어요.`,
  ];
  if (interruptedPartial) {
    parts.push(`그때까지 답변 누적분(중간):\n"""\n${interruptedPartial}\n"""`);
  }
  parts.push("그러나 사용자가 새 메시지로 방향을 바꿨어요. 새 요구를 우선 처리해요.");
  parts.push("");
  parts.push(`새 요구(이게 메인): ${current}`);
  return parts.join("\n");
}

/**
 * partialText tap — ai-sdk fullStream을 분기해 한쪽은 chat-sdk thread.post로,
 * 한쪽은 SteeringSlot.partialText에 누적한다 (steering 시 인터럽트 응답 컨텍스트로 사용).
 *
 * `result.fullStream.tee()` 결과 중 하나를 입력으로 받아 text-delta chunk 만 누적.
 */
export async function tapTextDelta(
  tapStream: ReadableStream<unknown>,
  onText: (delta: string) => void,
  onError?: (err: unknown) => void,
): Promise<void> {
  const reader = tapStream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (
        value &&
        typeof value === "object" &&
        (value as { type?: string }).type === "text-delta" &&
        typeof (value as { text?: unknown }).text === "string"
      ) {
        onText((value as { text: string }).text);
      }
    }
  } catch (err) {
    onError?.(err);
  } finally {
    reader.releaseLock();
  }
}
