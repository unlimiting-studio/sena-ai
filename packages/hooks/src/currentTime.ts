import type { TurnStartCallback, TurnStartDecision, ContextFragment } from "@sena-ai/core";

export type CurrentTimeOptions = {
  timezone?: string;
  locale?: string;
};

export function currentTimeHook(options?: CurrentTimeOptions): TurnStartCallback {
  const timezone = options?.timezone ?? "UTC";
  const locale = options?.locale ?? "ko-KR";

  return async (): Promise<TurnStartDecision> => {
    const now = new Date();

    const date = now.toLocaleDateString(locale, {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
    });

    const time = now.toLocaleTimeString(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const content = `현재: ${date} ${time} (${timezone})`;

    return {
      decision: "allow",
      fragments: [{ source: "currentTime", role: "append", content }],
    };
  };
}
