import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { formatAgentNameWithSuffix, getAgentSubject } from "../agentConfig.ts";
import { SlackClaudeAgent } from "../agents/slackClaudeAgent.ts";
import { CONFIG } from "../config.ts";
// import { upsertGithubCredential } from "../db/githubCredentials.ts";
import { GitHubSDK } from "../sdks/github.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isGithubLinkTokenExpired, parseGithubLinkToken } from "../utils/githubLinkToken.ts";

const TokenQuerySchema = z
  .object({
    token: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.token ?? value.state), {
    message: "token 또는 state 쿼리 파라미터가 필요합니다.",
    path: ["token"],
  })
  .transform((value) => value.token ?? value.state ?? "");

const CallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const AGENT_SUBJECT = getAgentSubject();
const AGENT_REQUEST_TARGET = formatAgentNameWithSuffix("에게");
const AGENT_CONNECT_TARGET = formatAgentNameWithSuffix("에");

const buildCallbackUrl = (): string => new URL("/api/auth/github/callback", CONFIG.BACKEND_URL).toString();

const renderHtmlPage = ({
  title,
  message,
  detail,
  variant,
}: {
  title: string;
  message: string;
  detail?: string;
  variant: "success" | "error" | "info";
}): string => {
  const badgeClasses: Record<typeof variant, string> = {
    success: "bg-emerald-100 text-emerald-700 border-emerald-200",
    error: "bg-rose-100 text-rose-700 border-rose-200",
    info: "bg-sky-100 text-sky-700 border-sky-200",
  };

  const badgeText: Record<typeof variant, string> = {
    success: "연동 완료",
    error: "연동 실패",
    info: "안내",
  };

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms"></script>
    <style>
      :root { color-scheme: light; }
      body {
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(191, 219, 254, 0.6), transparent 55%),
          linear-gradient(180deg, #f8fafc 0%, #ffffff 35%, #eff6ff 100%);
      }
    </style>
  </head>
  <body class="text-slate-900 antialiased selection:bg-blue-200 selection:text-slate-900">
    <div class="flex items-center justify-center min-h-screen px-6 py-16">
      <div class="max-w-xl w-full rounded-[32px] border border-slate-200 bg-white/95 shadow-[0_42px_120px_-50px_rgba(30,64,175,0.65)] backdrop-blur px-10 py-12 space-y-8">
        <span class="inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold border ${badgeClasses[variant]}">${badgeText[variant]}</span>
        <div class="space-y-4">
          <h1 class="text-3xl font-semibold tracking-tight text-slate-900">${title}</h1>
          <p class="text-base leading-relaxed text-slate-600">${message}</p>
        </div>
        ${
          detail
            ? `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <pre class="text-xs font-mono text-slate-600 whitespace-pre-wrap leading-relaxed">${detail}</pre>
        </div>`
            : ""
        }
        <div class="space-y-2 text-sm text-slate-500">
          <p>창을 닫아도 ${AGENT_SUBJECT} 작업을 계속 진행합니다.</p>
          <p>문제가 지속되면 관리자에게 문의해주세요.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
};

const sendHtml = (
  reply: FastifyReply,
  statusCode: number,
  payload: Parameters<typeof renderHtmlPage>[0],
): FastifyReply => reply.code(statusCode).type("text/html; charset=utf-8").send(renderHtmlPage(payload));

const fetchSlackMessageText = async ({
  channelId,
  threadTs,
  messageTs,
}: {
  channelId: string;
  threadTs: string | null;
  messageTs: string;
}): Promise<string> => {
  const sdk = SlackSDK.instance;
  if (threadTs && threadTs !== messageTs) {
    const response = await sdk.getThreadReplies({
      channel: channelId,
      ts: threadTs,
      oldest: messageTs,
      latest: messageTs,
      inclusive: true,
      limit: 1,
    });

    const message = response.messages?.find((item) => item.ts === messageTs) ?? response.messages?.[0];
    const text = typeof message?.text === "string" ? message.text : null;
    if (!text) {
      throw new Error("슬랙 쓰레드에서 원본 메시지를 찾을 수 없습니다.");
    }
    return text;
  }

  const history = await sdk.getChannelHistory({
    channel: channelId,
    oldest: messageTs,
    latest: messageTs,
    inclusive: true,
    limit: 1,
  });

  const message = history.messages?.[0];
  const text = typeof message?.text === "string" ? message.text : null;
  if (!text) {
    throw new Error("슬랙 채널 히스토리에서 원본 메시지를 찾을 수 없습니다.");
  }
  return text;
};

export async function githubOAuthRoutes(fastify: FastifyInstance) {
  fastify.get("/github/start", async (request, reply) => {
    try {
      const token = TokenQuerySchema.parse(request.query);
      const payload = parseGithubLinkToken(token);
      if (isGithubLinkTokenExpired(payload)) {
        sendHtml(reply, 410, {
          title: "링크가 만료되었습니다",
          message: `GitHub 연동 링크가 만료되었습니다. ${AGENT_REQUEST_TARGET} 다시 요청하여 새 링크를 발급받아 주세요.`,
          variant: "error",
        });
        return;
      }

      if (!CONFIG.GITHUB_OAUTH_CLIENT_ID) {
        sendHtml(reply, 500, {
          title: "환경 구성이 필요합니다",
          message: "GitHub OAuth 클라이언트 정보가 설정되어 있지 않아 연동을 진행할 수 없습니다.",
          variant: "error",
        });
        return;
      }

      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", CONFIG.GITHUB_OAUTH_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", buildCallbackUrl());
      authorizeUrl.searchParams.set("scope", "repo read:org user:email workflow");
      authorizeUrl.searchParams.set("state", token);
      authorizeUrl.searchParams.set("prompt", "select_account");
      authorizeUrl.searchParams.set("allow_signup", "false");

      reply.redirect(authorizeUrl.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub 연동 토큰을 확인하는 중 오류가 발생했습니다.";
      sendHtml(reply, 400, {
        title: "잘못된 요청입니다",
        message,
        variant: "error",
      });
    }
  });

  fastify.get("/github/callback", async (request, reply) => {
    if (!CONFIG.GITHUB_OAUTH_CLIENT_ID || !CONFIG.GITHUB_OAUTH_CLIENT_SECRET) {
      sendHtml(reply, 500, {
        title: "환경 구성이 필요합니다",
        message: "GitHub OAuth 클라이언트 정보가 설정되어 있지 않아 연동을 진행할 수 없습니다.",
        variant: "error",
      });
      return;
    }

    let parsedQuery: z.infer<typeof CallbackQuerySchema>;
    try {
      parsedQuery = CallbackQuerySchema.parse(request.query);
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub OAuth 응답을 해석할 수 없습니다.";
      sendHtml(reply, 400, {
        title: "잘못된 요청입니다",
        message,
        variant: "error",
      });
      return;
    }

    if (parsedQuery.error) {
      sendHtml(reply, 400, {
        title: "GitHub 연동이 취소되었습니다",
        message: parsedQuery.error_description ?? "사용자가 GitHub OAuth를 취소했습니다.",
        variant: "info",
      });
      return;
    }

    let payload: ReturnType<typeof parseGithubLinkToken>;
    try {
      payload = parseGithubLinkToken(parsedQuery.state);
      if (isGithubLinkTokenExpired(payload)) {
        sendHtml(reply, 410, {
          title: "링크가 만료되었습니다",
          message: `GitHub 연동 링크가 만료되었습니다. ${AGENT_REQUEST_TARGET} 다시 요청하여 새 링크를 발급받아 주세요.`,
          variant: "error",
        });
        return;
      }
    } catch {
      sendHtml(reply, 400, {
        title: "잘못된 요청입니다",
        message: "GitHub 연동 토큰을 확인할 수 없습니다.",
        variant: "error",
      });
      return;
    }

    try {
      const sdk = await GitHubSDK.fromCode({
        clientId: CONFIG.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: CONFIG.GITHUB_OAUTH_CLIENT_SECRET,
        code: parsedQuery.code,
        redirectUri: buildCallbackUrl(),
      });
      const user = await sdk.getAuthenticatedUser();

      // await upsertGithubCredential({
      //   slackUserId: payload.slackUserId,
      //   accessToken: sdk.getAccessToken(),
      // });

      const continuationText = "GitHub 연동이 완료되었습니다. 작업을 계속합니다.";
      let resumed = false;

      if (payload.sessionId) {
        resumed = await SlackClaudeAgent.instance
          .resumeSessionFromLinkToken({
            sessionId: payload.sessionId,
            slack: {
              teamId: null,
              channelId: payload.channelId,
              threadTs: payload.threadTs,
              messageTs: payload.messageTs,
              slackUserId: payload.slackUserId,
            },
            provider: "github",
            continuationText,
          })
          .catch(() => false);
      }

      if (!resumed) {
        let originalMessage: string;
        try {
          originalMessage = await fetchSlackMessageText({
            channelId: payload.channelId,
            threadTs: payload.threadTs,
            messageTs: payload.messageTs,
          });
        } catch {
          originalMessage = continuationText;
        }

        void SlackClaudeAgent.instance.handleMention({
          teamId: null,
          channelId: payload.channelId,
          userId: payload.slackUserId,
          text: originalMessage,
          threadTs: payload.threadTs,
          messageTs: payload.messageTs,
        });
      }

      sendHtml(reply, 200, {
        title: "GitHub 연동이 완료되었습니다",
        message: `${user.login} 계정이 ${AGENT_CONNECT_TARGET} 연결되었습니다. 창을 닫아도 ${AGENT_SUBJECT} 자동으로 작업을 이어갑니다.`,
        variant: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub OAuth 처리 중 오류가 발생했습니다.";
      sendHtml(reply, 500, {
        title: "GitHub 연동에 실패했습니다",
        message: "GitHub에서 토큰을 발급받거나 정보를 확인하는 과정에서 문제가 발생했습니다.",
        detail: message,
        variant: "error",
      });
    }
  });
}
