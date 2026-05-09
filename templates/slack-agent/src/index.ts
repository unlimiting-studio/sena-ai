import { defineConfig, requiredEnv, run } from "@sena-ai/app";
import { slackAdapter } from "@sena-ai/app/adapters/slack";
import { channelContext, traceLogger } from "@sena-ai/app/middlewares";
import { cronSchedule } from "@sena-ai/app/schedules";
import { postgresState } from "@sena-ai/app/state";
import { claudeCode } from "ai-sdk-provider-claude-code";

const config = defineConfig({
  cwd: import.meta.dirname,
  model: claudeCode("sonnet"),
  adapters: [
    slackAdapter({
      appToken: requiredEnv("SLACK_APP_TOKEN"),
      botToken: requiredEnv("SLACK_BOT_TOKEN"),
    }),
  ],
  middlewares: [
    channelContext({
      cwd: import.meta.dirname,
      channelsFile: ".sena/channels.json",
      memoryDir: ".sena/channels",
    }),
    traceLogger({ label: "sena" }),
  ],
  schedules: [
    cronSchedule({
      name: "morning-briefing",
      cron: "0 8 * * *",
      target: { type: "slack-channel", id: "C0YOURCHANNEL" },
      prompt: { file: ".sena/prompts/morning-briefing.md" },
    }),
  ],
  state: postgresState({ connectionString: requiredEnv("DATABASE_URL") }),
});

const app = await run(config, { steerMode: "steering" });

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void app.shutdown().then(() => process.exit(0));
  });
}
