import { createMemoryState } from "@chat-adapter/state-memory";
import { createPostgresState } from "@chat-adapter/state-pg";
import type { StateAdapter } from "chat";
import type { StateInput } from "../config.js";

export function resolveStateAdapter(input: StateInput): StateAdapter {
  if (isStateAdapter(input)) return input;
  if (input.type === "memory") return createMemoryState();
  if (input.type === "pg") {
    const { type: _type, connectionString, ...rest } = input;
    const url = rest.url ?? connectionString ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "[@sena-ai/app] state.type='pg' requires `url`/`connectionString` or DATABASE_URL.",
      );
    }
    return createPostgresState({ ...rest, url });
  }

  const neverInput: never = input;
  throw new Error(`[@sena-ai/app] unsupported state config: ${JSON.stringify(neverInput)}`);
}

function isStateAdapter(value: unknown): value is StateAdapter {
  if (!isRecord(value)) return false;
  return (
    typeof value.connect === "function" &&
    typeof value.disconnect === "function" &&
    typeof value.subscribe === "function" &&
    typeof value.unsubscribe === "function" &&
    typeof value.acquireLock === "function" &&
    typeof value.releaseLock === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
