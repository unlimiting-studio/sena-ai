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
    // 매일 오전 9시(KST) — 어제의 journal을 기반으로 일일 브리핑 포스트
    cronSchedule("0 9 * * 1-5", {
      name: "daily-briefing",
      prompt: readFileSync("prompts/DAILY_BRIEFING.md", "utf-8"),
      timezone: "Asia/Seoul",
    }),

    // 매주 금요일 오후 5시(KST) — 한 주 활동을 정리하는 주간 회고
    cronSchedule("0 17 * * 5", {
      name: "weekly-retrospective",
      prompt: readFileSync("prompts/WEEKLY_RETROSPECTIVE.md", "utf-8"),
      timezone: "Asia/Seoul",
    }),

    // 30분마다 — 채널을 살펴보고 미응답 질문이나 도움 요청에 능동 대응
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
            ``,
            `## 중복 방지 (중요)`,
            `이 세션은 기존 대화를 이어받았기 때문에, 이전 턴의 내용이 컨텍스트에 포함되어 있어.`,
            `먼저 journal/${date}.md를 읽어서 이미 기록된 내용을 확인하고,`,
            `아직 기록되지 않은 이번 턴의 새로운 내용만 추가해.`,
            `이미 기록된 대화를 다시 요약하거나 반복하지 마.`,
            ``,
            `## 기록할 엔트리 형식:`,
            `기존 파일이 있으면 끝에 추가하고, 없으면 새로 생성해.`,
            ``,
            `### ${time} — ${user} (${channel})`,
            `- **요청**: (이번 턴의 사용자 요청을 한 줄로 요약)`,
            `- **수행**: (이번 턴에서 에이전트가 한 일을 간결하게)`,
            `- **결과**: (결과 또는 결론)`,
            `- **의사결정**: (있으면 기록, 없으면 생략)`,
            ``,
            `## 이번 턴의 대화 컨텍스트:`,
            `사용자 입력: ${ctx.input}`,
            `에이전트 응답 (앞부분): ${result.text.slice(0, 500)}`,
          ].join("\n"),
        };
      },
    ],
  },
});
