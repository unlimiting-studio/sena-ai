import { AsyncLocalStorage } from "node:async_hooks";

export type SenaTriggerKind = "mention" | "subscribed-message" | "schedule";

export interface SenaTurnContext {
  /** Transport adapter name. 1차는 slack 중심. */
  adapter?: string;
  /** Bare channel id when known (for Slack: C... / G... / D...). */
  channelId?: string;
  /** chat-sdk thread id when known (for Slack: slack:C...:ts). */
  threadId?: string;
  /** Human-readable origin for logs / prompt decoration. */
  trigger?: SenaTriggerKind;
}

const storage = new AsyncLocalStorage<SenaTurnContext>();

export function getTurnContext(): SenaTurnContext | undefined {
  return storage.getStore();
}

export function runWithTurnContext<T>(context: SenaTurnContext, fn: () => T): T {
  const current = storage.getStore();
  return storage.run({ ...current, ...compactContext(context) }, fn);
}

export function channelIdFromChatSdkId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const parts = id.split(":");
  if (parts.length >= 2 && parts[0] === "slack") return parts[1];
  if (/^[CDG][A-Z0-9]+$/.test(id)) return id;
  return undefined;
}

export function adapterFromChatSdkId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const [adapter] = id.split(":");
  return adapter && adapter !== id ? adapter : undefined;
}

function compactContext(context: SenaTurnContext): SenaTurnContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  ) as SenaTurnContext;
}
