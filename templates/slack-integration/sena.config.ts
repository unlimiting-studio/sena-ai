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
        if (input.turnContext.trigger !== "connector") return;

        return {
          fork: true,
          detached: true,
          followUp: [
            `이전 대화의 핵심 내용을 journal에 기록해.`,
            ``,
            `- 현재 시간과 메시지 컨텍스트(채널, 사용자)는 시스템 프롬프트에 이미 있으니 그걸 참고해.`,
            `- 파일명은 journal/{오늘 날짜}.md (예: journal/2026-04-06.md).`,
            `- 기존 파일이 있으면 먼저 읽어서 중복 기록하지 마. 새로운 내용만 끝에 추가해.`,
            ``,
            `## 엔트리 형식`,
            `### {시간} — {사용자} ({채널})`,
            `- **요청**: (사용자 요청 한 줄 요약)`,
            `- **수행**: (에이전트가 한 일)`,
            `- **결과**: (결론)`,
            `- **의사결정**: (있으면 기록)`,
          ].join("\n"),
        };
      },
    ],
  },
});
