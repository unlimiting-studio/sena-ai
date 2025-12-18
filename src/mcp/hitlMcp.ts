import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import { CONFIG } from "../config.ts";
import { findGithubCredentialBySlackUserId } from "../db/githubCredentials.ts";
import { GitHubSDK } from "../sdks/github.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { createGithubLinkToken } from "../utils/githubLinkToken.ts";

export type KarbyHitlMcpContext = {
  slack: {
    channelId: string;
    threadTs: string | null;
    messageTs: string;
    slackUserId: string;
  };
  getSessionId: () => string | null;
};

const postGithubOauthPrompt = async (ctx: KarbyHitlMcpContext, reason: string | null): Promise<void> => {
  const sessionId = ctx.getSessionId();
  const { token, expiresAt } = createGithubLinkToken({
    slackUserId: ctx.slack.slackUserId,
    channelId: ctx.slack.channelId,
    threadTs: ctx.slack.threadTs ?? ctx.slack.messageTs,
    messageTs: ctx.slack.messageTs,
    sessionId,
  });

  const url = new URL("/api/auth/github/start", CONFIG.BACKEND_URL);
  url.searchParams.set("state", token);
  const expiresInMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000));
  const reasonText = reason ? `${reason} ` : "";

  await SlackSDK.instance.postEphemeral({
    channel: ctx.slack.channelId,
    user: ctx.slack.slackUserId,
    thread_ts: ctx.slack.threadTs ?? ctx.slack.messageTs,
    text: "GitHub 연동이 필요해요. 버튼을 눌러 연동을 완료하면 카비가 작업을 이어갑니다.",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "GitHub 계정 연동", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${reasonText}GitHub 작업을 위해 사용자 토큰이 필요합니다. 아래 버튼으로 연동을 완료해주세요.`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "🔗 GitHub 계정 연동하기", emoji: true },
            style: "primary",
            url: url.toString(),
            action_id: "github_oauth_start",
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

export const createSenaHitlMcpServer = (ctx: KarbyHitlMcpContext) =>
  createSdkMcpServer({
    name: "karby-auth",
    version: "0.0.1",
    tools: [
      tool(
        "guide_github_integration",
        "GitHub OAuth 연동이 필요할 때, 사용자에게 에페메랄 안내를 보냅니다.",
        {
          reason: z.string().optional(),
        },
        async (args) => {
          const credential = await findGithubCredentialBySlackUserId(ctx.slack.slackUserId);
          if (credential?.accessToken) {
            return { content: [{ type: "text", text: "이미 GitHub 계정이 연동되어 있습니다." }] };
          }

          await postGithubOauthPrompt(ctx, args.reason?.trim() || null).catch(() => undefined);
          return {
            content: [
              {
                type: "text",
                text: "GitHub 계정이 연동되어 있지 않습니다. 개인 메시지로 연동 링크를 보냈습니다.",
              },
            ],
            isError: true,
          };
        }
      ),
      tool(
        "guide_repo_permission",
        "특정 GitHub 리포지토리에 대한 Write 권한이 필요한 경우, 권한을 확인하고 없으면 안내를 보냅니다.",
        {
          owner: z.string(),
          repo: z.string(),
          reason: z.string().optional(),
        },
        async (args) => {
          const credential = await findGithubCredentialBySlackUserId(ctx.slack.slackUserId);
          const token = credential?.accessToken ?? null;

          if (!token) {
            await postGithubOauthPrompt(ctx, args.reason?.trim() || null).catch(() => undefined);
            return {
              content: [{ type: "text", text: "GitHub 연동이 필요합니다. 개인 메시지로 연동 링크를 보냈습니다." }],
              isError: true,
            };
          }

          try {
            const sdk = new GitHubSDK(token);
            const user = await sdk.getAuthenticatedUser();
            const { hasPushAccess, permission } = await sdk.getCollaboratorPermissionLevel(
              args.owner,
              args.repo,
              user.login
            );
            if (hasPushAccess) {
              return {
                content: [{ type: "text", text: `${args.owner}/${args.repo} 권한 확인됨: ${permission}` }],
              };
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : "알 수 없는 오류";
            return {
              content: [{ type: "text", text: `권한 확인 실패: ${message}` }],
              isError: true,
            };
          }

          const sessionId = ctx.getSessionId();
          const { token: linkToken } = createGithubLinkToken({
            slackUserId: ctx.slack.slackUserId,
            channelId: ctx.slack.channelId,
            threadTs: ctx.slack.threadTs ?? ctx.slack.messageTs,
            messageTs: ctx.slack.messageTs,
            sessionId,
          });

          const benchUrl = "https://bench.kr.wekarrot.net/accounts/102";
          const reasonText = args.reason?.trim() ? `${args.reason.trim()} ` : "";
          const actionValue = JSON.stringify({ owner: args.owner, repo: args.repo, token: linkToken });

          await SlackSDK.instance.postMessage({
            channel: ctx.slack.channelId,
            thread_ts: ctx.slack.threadTs ?? ctx.slack.messageTs,
            text: `${args.owner}/${args.repo} 리포지토리에 대한 Write 권한이 필요합니다.`,
            blocks: [
              {
                type: "header",
                text: { type: "plain_text", text: "리포지토리 권한 신청이 필요해요", emoji: true },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `${reasonText}\`${args.owner}/${args.repo}\` 리포지토리에 Write 권한이 필요합니다.\n\nBench에서 권한을 신청한 뒤, 아래 [권한 승인 완료] 버튼을 눌러주세요.`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "📋 권한 신청하기", emoji: true },
                    style: "primary",
                    url: benchUrl,
                    action_id: "repo_permission_request",
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "✅ 권한 승인 완료", emoji: true },
                    action_id: "repo_permission_granted",
                    value: actionValue,
                  },
                ],
              },
            ],
          });

          return {
            content: [{ type: "text", text: "Write 권한이 필요합니다. Slack에 권한 신청 안내를 전송했습니다." }],
            isError: true,
          };
        }
      ),
    ],
  });
