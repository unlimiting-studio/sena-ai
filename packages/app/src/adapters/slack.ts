import {
  createSlackAdapter,
  type SlackAdapterConfig,
  type SlackAdapterMode,
} from "@chat-adapter/slack";

export { createSlackAdapter, SlackAdapter } from "@chat-adapter/slack";
export type { SlackAdapterConfig, SlackAdapterMode, SlackBotToken } from "@chat-adapter/slack";

export type SenaSlackAdapterOptions = Partial<SlackAdapterConfig> & {
  /** Default is socket because API-key-only local/prod setup should not require a public webhook first. */
  mode?: SlackAdapterMode;
};

export function slackAdapter(options: SenaSlackAdapterOptions = {}) {
  return createSlackAdapter({ mode: "socket", ...options });
}
