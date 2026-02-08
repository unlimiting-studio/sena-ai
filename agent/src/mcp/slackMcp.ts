import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { getAgentSubject } from "../agentConfig.ts";
import { CONFIG } from "../config.ts";
import { SlackSDK } from "../sdks/slack.ts";

export type KarbySlackMcpContext = {
  slack: {
    teamId: string | null;
    channelId: string;
    threadTs: string | null;
    messageTs: string;
    slackUserId: string;
  };
  getSessionId: () => string | null;
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const formatSlackMessage = (msg: unknown): string | null => {
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const record = msg as Record<string, unknown>;
  const ts = toNonEmptyString(record.ts) ?? "unknown";
  const userId = toNonEmptyString(record.user);
  const text = toNonEmptyString(record.text) ?? "";

  const author = userId ? `<@${userId}>` : "<unknown>";
  return `[${ts}] ${author}: ${text}`;
};

export const createSenaSlackMcpServer = (ctx: KarbySlackMcpContext) =>
  createSdkMcpServer({
    name: "slack",
    version: "0.0.1",
    tools: [
      tool(
        "get_messages",
        "Slack 채널/쓰레드 메시지를 읽어옵니다.",
        {
          mode: z.enum(["thread", "channel"]).default("thread"),
          channelId: z.string().optional().describe("기본값: 현재 Slack 컨텍스트 channelId"),
          threadTs: z.string().optional().describe("mode=thread일 때 대상 thread ts. 기본값: 현재 컨텍스트 threadTs"),
          limit: z.number().int().min(1).max(100).default(20),
          latest: z.string().optional(),
          oldest: z.string().optional(),
        },
        async (args) => {
          const channelId = args.channelId?.trim() || ctx.slack.channelId;
          const mode = args.mode;
          const threadTs = args.threadTs?.trim() || ctx.slack.threadTs || ctx.slack.messageTs;

          const response =
            mode === "thread"
              ? await SlackSDK.instance.getThreadReplies({
                  channel: channelId,
                  ts: threadTs,
                  limit: args.limit,
                  latest: args.latest,
                  oldest: args.oldest,
                })
              : await SlackSDK.instance.getChannelHistory({
                  channel: channelId,
                  limit: args.limit,
                  latest: args.latest,
                  oldest: args.oldest,
                });

          const messages = toArray(response.messages);
          const lines = messages
            .map((message) => formatSlackMessage(message))
            .filter((line): line is string => Boolean(line));

          const header = `Slack messages (${mode}). count=${lines.length}`;
          const body = lines.length > 0 ? lines.join("\n") : "(no messages)";

          return {
            content: [{ type: "text", text: `${header}\n\n${body}` }],
          };
        },
      ),
      tool(
        "download_file",
        "Slack 파일을 다운로드합니다. 파일 ID를 받아 로컬 워크스페이스에 저장하고 경로를 반환합니다.",
        {
          fileId: z.string().describe("Slack 파일 ID (예: F07ABCDEF12)"),
        },
        async (args) => {
          const fileInfo = await SlackSDK.instance.getFileInfo({ file: args.fileId });
          const file = fileInfo.file;

          if (!file) {
            return {
              content: [{ type: "text", text: `파일을 찾을 수 없습니다: ${args.fileId}` }],
            };
          }

          const downloadUrl = file.url_private_download ?? file.url_private;
          if (!downloadUrl) {
            return {
              content: [{ type: "text", text: `다운로드 URL이 없습니다. 파일 타입: ${file.filetype ?? "unknown"}` }],
            };
          }

          const downloadDir = path.join(CONFIG.WORKSPACE_DIR, "slack-downloads");
          await fs.mkdir(downloadDir, { recursive: true });

          const safeName = (file.name ?? `${args.fileId}.${file.filetype ?? "bin"}`).replace(/[^a-zA-Z0-9._-]/g, "_");
          const localPath = path.join(downloadDir, `${args.fileId}_${safeName}`);

          const buffer = await SlackSDK.instance.downloadFile(downloadUrl);
          await fs.writeFile(localPath, Buffer.from(buffer));

          const sizeKB = Math.round((file.size ?? buffer.byteLength) / 1024);

          return {
            content: [
              {
                type: "text",
                text: [
                  `파일 다운로드 완료`,
                  `- 이름: ${file.name ?? "unknown"}`,
                  `- 타입: ${file.filetype ?? "unknown"}`,
                  `- 크기: ${sizeKB} KB`,
                  `- 경로: ${localPath}`,
                ].join("\n"),
              },
            ],
          };
        },
      ),
    ],
  });
