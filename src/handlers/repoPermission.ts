import { SlackClaudeAgent } from "../agents/slackClaudeAgent.ts";
import { findGithubCredentialBySlackUserId } from "../db/githubCredentials.ts";
import { GitHubSDK } from "../sdks/github.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { isGithubLinkTokenExpired, parseGithubLinkToken } from "../utils/githubLinkToken.ts";
import { isRecord } from "../utils/object.ts";

export interface RepoPermissionGrantedParams {
  userId: string;
  channelId: string | null;
  messageTs: string | null;
  threadTs: string | null;
  actionValue: string | null;
}

const sendEphemeralResponse = async (params: {
  channelId: string | null;
  userId: string;
  threadTs: string | null;
  text: string;
}): Promise<void> => {
  const { channelId, userId, threadTs, text } = params;
  if (!channelId) {
    return;
  }
  await SlackSDK.instance
    .postEphemeral({
      channel: channelId,
      user: userId,
      thread_ts: threadTs ?? undefined,
      text,
    })
    .catch(() => undefined);
};

export async function handleRepoPermissionGranted(params: RepoPermissionGrantedParams): Promise<void> {
  const { userId, channelId, messageTs, threadTs, actionValue } = params;

  const actionValueJson = actionValue?.trim() ?? "";
  if (actionValueJson.length === 0) {
    await sendEphemeralResponse({
      channelId,
      userId,
      threadTs: threadTs ?? messageTs,
      text: "⚠️ 요청 처리에 실패했습니다. 다시 시도해주세요.",
    });
    return;
  }

  let owner: string;
  let repo: string;
  let token: string;

  try {
    const parsed: unknown = JSON.parse(actionValueJson);
    if (!isRecord(parsed)) {
      throw new Error("invalid_action_value");
    }

    const parsedOwner = parsed.owner;
    const parsedRepo = parsed.repo;
    const parsedToken = parsed.token;

    if (typeof parsedOwner !== "string" || typeof parsedRepo !== "string" || typeof parsedToken !== "string") {
      throw new Error("missing_fields");
    }

    owner = parsedOwner;
    repo = parsedRepo;
    token = parsedToken;
  } catch {
    await sendEphemeralResponse({
      channelId,
      userId,
      threadTs: threadTs ?? messageTs,
      text: "⚠️ 요청 처리에 실패했습니다. 다시 시도해주세요.",
    });
    return;
  }

  let tokenPayload: ReturnType<typeof parseGithubLinkToken>;
  try {
    tokenPayload = parseGithubLinkToken(token);
  } catch {
    await sendEphemeralResponse({
      channelId,
      userId,
      threadTs: threadTs ?? messageTs,
      text: "⚠️ 요청 처리에 실패했습니다. 다시 시도해주세요.",
    });
    return;
  }

  const resolvedChannelId = channelId ?? tokenPayload.channelId;
  const resolvedThreadTs = threadTs ?? tokenPayload.threadTs ?? tokenPayload.messageTs;

  if (isGithubLinkTokenExpired(tokenPayload)) {
    await sendEphemeralResponse({
      channelId: resolvedChannelId,
      userId,
      threadTs: resolvedThreadTs,
      text: "⚠️ 요청이 만료되었습니다. 카비에게 다시 요청해주세요.",
    });
    return;
  }

  if (tokenPayload.slackUserId !== userId) {
    await sendEphemeralResponse({
      channelId: resolvedChannelId,
      userId,
      threadTs: resolvedThreadTs,
      text: "⚠️ 이 버튼은 요청한 본인만 클릭할 수 있습니다.",
    });
    return;
  }

  const credential = await findGithubCredentialBySlackUserId(userId);
  if (!credential?.accessToken) {
    await sendEphemeralResponse({
      channelId: resolvedChannelId,
      userId,
      threadTs: resolvedThreadTs,
      text: "⚠️ GitHub 계정이 연동되어 있지 않습니다. 먼저 GitHub 계정을 연동해주세요.",
    });
    return;
  }

  try {
    const sdk = new GitHubSDK(credential.accessToken);
    const user = await sdk.getAuthenticatedUser();
    const { hasPushAccess } = await sdk.getCollaboratorPermissionLevel(owner, repo, user.login);

    if (!hasPushAccess) {
      await sendEphemeralResponse({
        channelId: resolvedChannelId,
        userId,
        threadTs: resolvedThreadTs,
        text: `⚠️ \`${owner}/${repo}\` 리포지토리에 아직 Write 권한이 없습니다.\n\nBench에서 권한 승인이 완료되었는지 확인 후 다시 시도해주세요.`,
      });
      return;
    }

    if (resolvedChannelId) {
      await SlackSDK.instance
        .postMessage({
          channel: resolvedChannelId,
          thread_ts: resolvedThreadTs ?? undefined,
          text: `✅ \`${owner}/${repo}\` 리포지토리 권한이 확인되었습니다. 작업을 계속합니다.`,
        })
        .catch(() => undefined);
    }

    if (tokenPayload.sessionId) {
      const continuationText = `GitHub 리포지토리 ${owner}/${repo}에 대한 Write 권한이 확인되었습니다. 작업을 계속합니다.`;
      await SlackClaudeAgent.instance
        .resumeSessionFromLinkToken({
          sessionId: tokenPayload.sessionId,
          slack: {
            teamId: null,
            channelId: tokenPayload.channelId,
            threadTs: tokenPayload.threadTs,
            messageTs: tokenPayload.messageTs,
            slackUserId: tokenPayload.slackUserId,
          },
          provider: "github",
          continuationText,
        })
        .catch(() => undefined);
    }
  } catch {
    await sendEphemeralResponse({
      channelId: resolvedChannelId,
      userId,
      threadTs: resolvedThreadTs,
      text: "⚠️ 권한 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
}
