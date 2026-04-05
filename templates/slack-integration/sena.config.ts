import { defineConfig, env } from "@sena-ai/core";
import { claudeRuntime } from "@sena-ai/runtime-claude";
import { slackConnector, slackTools } from "@sena-ai/slack";

export default defineConfig({
  name: "%%BOT_NAME%%",

  runtime: claudeRuntime({
    model: "claude-sonnet-4-6",
  }),

  connectors: [
    slackConnector({
      appId: env("SLACK_APP_ID"),
      botToken: env("SLACK_BOT_TOKEN"),
      signingSecret: env("SLACK_SIGNING_SECRET"),
      triggers: {
        mention: {
          file: "prompts/SLACK_MENTION.md",
        },
      },
    }),
  ],

  tools: [...slackTools({ botToken: env("SLACK_BOT_TOKEN") })],
});
