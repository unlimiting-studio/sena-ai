import { defineConfig, env } from "@sena-ai/core";
import { claudeRuntime } from "@sena-ai/runtime-claude";
import { slackConnector, slackTools } from "@sena-ai/slack";
import { fileContextHook } from "@sena-ai/hooks";

export default defineConfig({
  name: "%%BOT_NAME%%",

  runtime: claudeRuntime({
    model: "claude-sonnet-4-6",
  }),

  connectors: [
    slackConnector({
      mode: "socket",
      appId: env("SLACK_APP_ID"),
      appToken: env("SLACK_APP_TOKEN"),
      botToken: env("SLACK_BOT_TOKEN"),
      triggers: {
        mention: {
          file: "prompts/SLACK_MENTION.md",
        },
      },
    }),
  ],

  tools: [...slackTools({ botToken: env("SLACK_BOT_TOKEN") })],

  hooks: {
    onTurnStart: [
      fileContextHook({
        as: "system",
        path: "prompts/SYSTEM.md",
      }),
    ],
  },
});
