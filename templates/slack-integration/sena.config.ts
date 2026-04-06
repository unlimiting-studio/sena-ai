import { defineConfig, env, cronSchedule, heartbeat } from "@sena-ai/core";
import { claudeRuntime } from "@sena-ai/runtime-claude";
import { slackConnector, slackTools } from "@sena-ai/slack";
import { fileContextHook, currentTimeHook } from "@sena-ai/hooks";
import { readFileSync } from "fs";

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
      thinkingMessage: "%%BOT_NAME%% is thinking...",
      triggers: {
        mention: {
          file: "prompts/SLACK_MENTION.md",
        },
        reactions: {
          x: { action: "abort" },
        },
      },
    }),
  ],

  tools: [...slackTools({ botToken: env("SLACK_BOT_TOKEN") })],

  schedules: [
    // Every weekday at 9:00 AM KST — post a daily briefing based on yesterday's journal
    cronSchedule("0 9 * * 1-5", {
      name: "daily-briefing",
      prompt: readFileSync("prompts/DAILY_BRIEFING.md", "utf-8"),
      timezone: "Asia/Seoul",
    }),

    // Every Friday at 5:00 PM KST — post a weekly retrospective of the week's activity
    cronSchedule("0 17 * * 5", {
      name: "weekly-retrospective",
      prompt: readFileSync("prompts/WEEKLY_RETROSPECTIVE.md", "utf-8"),
      timezone: "Asia/Seoul",
    }),

    // Every 30 minutes — watch channels and respond proactively to unanswered questions or requests for help
    heartbeat("30m", {
      name: "channel-watch",
      prompt: readFileSync("prompts/HEARTBEAT_CHECK.md", "utf-8"),
    }),
  ],

  hooks: {
    onTurnStart: [
      fileContextHook({
        as: "system",
        path: "prompts/SYSTEM.md",
      }),
      fileContextHook({
        as: "system",
        path: "prompts/IDENTITY.md",
      }),
      fileContextHook({
        as: "system",
        path: "prompts/USER.md",
      }),
      currentTimeHook({ timezone: "Asia/Seoul" }),
    ],
    onTurnEnd: [
      async (input) => {
        if (input.turnContext.trigger !== "connector") return;

        return {
          fork: true,
          detached: true,
          followUp: [
            `Record the key points of the previous conversation in the journal.`,
            ``,
            `- The current time and message context (channel, user) are already present in the system prompt, so use them.`,
            `- Use the filename ./journal/{today's date}.md, for example ./journal/2026-04-06.md.`,
            `- If the file already exists, read it first so you do not duplicate entries. Append only the new information.`,
            ``,
            `## Entry Format`,
            `### {time} — {user} ({channel})`,
            `- **Request**: (one-line summary of the user's request)`,
            `- **Action**: (what the agent did)`,
            `- **Result**: (the conclusion)`,
            `- **Decision**: (record this if there was a decision)`,
          ].join("\n"),
        };
      },
    ],
  },
});
