import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { CONFIG } from "../config.ts";
import { findSlackCredentialBySlackUserId } from "../db/slackCredentials.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { createSlackLinkToken } from "../utils/slackLinkToken.ts";

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

const postSlackSearchOauthPrompt = async (ctx: KarbySlackMcpContext): Promise<void> => {
  const sessionId = ctx.getSessionId();
  const { token, expiresAt } = createSlackLinkToken({
    teamId: ctx.slack.teamId,
    channelId: ctx.slack.channelId,
    threadTs: ctx.slack.threadTs ?? ctx.slack.messageTs,
    messageTs: ctx.slack.messageTs,
    slackUserId: ctx.slack.slackUserId,
    sessionId,
  });

  const url = new URL("/api/auth/slack/start", CONFIG.BACKEND_URL);
  url.searchParams.set("scope", "search");
  url.searchParams.set("state", token);
  const expiresInMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000));

  await SlackSDK.instance.postEphemeral({
    channel: ctx.slack.channelId,
    user: ctx.slack.slackUserId,
    thread_ts: ctx.slack.threadTs ?? ctx.slack.messageTs,
    text: "Slack 검색 권한 연동이 필요해요. 버튼을 눌러 연동을 완료하면 카비가 작업을 이어갑니다.",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Slack 검색 권한 연동", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Slack 메시지 검색을 위해 사용자 토큰 권한(search:read)이 필요합니다. 아래 버튼을 눌러 연동을 완료해주세요.",
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 Slack 검색 권한 연동", emoji: true },
            style: "primary",
            url: url.toString(),
            action_id: "slack_oauth_start",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `⏱️ 이 링크는 *${expiresInMinutes}분* 동안 유효합니다 • 🔒 개인에게만 보이는 메시지입니다`,
          },
        ],
      },
    ],
  });
};

export const createSenaSlackMcpServer = (ctx: KarbySlackMcpContext) =>
  createSdkMcpServer({
    name: "karby-slack",
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

          const lines = (response.messages ?? [])
            .map((message) => formatSlackMessage(message))
            .filter((line): line is string => Boolean(line));

          const header = `Slack messages (${mode}). count=${lines.length}`;
          const body = lines.length > 0 ? lines.join("\n") : "(no messages)";

          return {
            content: [{ type: "text", text: `${header}\n\n${body}` }],
          };
        }
      ),
      tool(
        "search_messages",
        "Slack 메시지를 검색합니다. search:read 권한이 없으면 연동 안내를 보냅니다.",
        {
          query: z.string(),
          sort: z.enum(["score", "timestamp"]).default("score"),
          count: z.number().int().min(1).max(100).default(20),
          page: z.number().int().min(1).default(1),
        },
        async (args) => {
          const credential = await findSlackCredentialBySlackUserId(ctx.slack.slackUserId);
          const userToken = credential?.accessToken ?? null;
          if (!userToken) {
            await postSlackSearchOauthPrompt(ctx).catch(() => undefined);
            return {
              content: [
                {
                  type: "text",
                  text: "Slack 검색 권한(search:read)이 없습니다. 개인 메시지로 연동 링크를 보냈습니다.",
                },
              ],
              isError: true,
            };
          }

          try {
            const result = await SlackSDK.instance.searchMessagesWithUserToken(userToken, args.query, {
              sort: args.sort,
              sort_dir: "desc",
              count: args.count,
              page: args.page,
              highlight: true,
            });

            if (!result.ok) {
              if (result.error === "missing_scope") {
                await postSlackSearchOauthPrompt(ctx).catch(() => undefined);
              }
              return {
                content: [{ type: "text", text: `Slack 검색 실패: ${result.error ?? "unknown_error"}` }],
                isError: true,
              };
            }

            const matches = result.messages?.matches ?? [];
            const lines = matches.map((match) => {
              const channel = match.channel?.name ? `#${match.channel.name}` : match.channel?.id ?? "";
              const ts = match.ts ?? "";
              const user = match.username ? `@${match.username}` : match.user ?? "";
              const text = match.text ?? "";
              const permalink = match.permalink ? ` (${match.permalink})` : "";
              return `- [${ts}] ${user} in ${channel}: ${text}${permalink}`;
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Search results for "${args.query}": total=${result.messages?.total ?? 0}, returned=${
                    matches.length
                  }\n\n${lines.join("\n")}`,
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 오류";
            return {
              content: [{ type: "text", text: `Slack 검색 중 오류: ${message}` }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
