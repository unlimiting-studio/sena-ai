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
    ],
    onTurnEnd: [
      async (input) => {
        const ctx = input.turnContext;
        const result = input.result;

        // Skip non-connector turns (schedules, programmatic)
        if (ctx.trigger !== "connector") return;

        const date = new Date().toISOString().slice(0, 10);
        const time = new Date().toLocaleTimeString("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const channel = ctx.connector?.conversationId ?? "unknown";
        const user = ctx.connector?.userName ?? ctx.connector?.userId ?? "unknown";

        return {
          fork: true,
          detached: true,
          followUp: [
            `이전 대화의 핵심 내용을 journal/${date}.md에 기록해.`,
            `기존 파일이 있으면 끝에 추가하고, 없으면 새로 생성해.`,
            ``,
            `## 기록할 엔트리 형식:`,
            `### ${time} — ${user} (${channel})`,
            `- **요청**: (사용자 요청을 한 줄로 요약)`,
            `- **수행**: (에이전트가 한 일을 간결하게)`,
            `- **결과**: (결과 또는 결론)`,
            `- **의사결정**: (있으면 기록, 없으면 생략)`,
            ``,
            `## 대화 컨텍스트:`,
            `사용자 입력: ${ctx.input}`,
            `에이전트 응답 (앞부분): ${result.text.slice(0, 500)}`,
          ].join("\n"),
        };
      },
    ],
  },
});
