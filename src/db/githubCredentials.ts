import { eq } from "drizzle-orm";
import { getDB } from "./connection.ts";
import { githubCredentials } from "./schema.ts";

export interface GithubCredentialRecord {
  id: number;
  userId: string | null;
  slackUserId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export const findGithubCredentialBySlackUserId = async (
  slackUserId: string,
): Promise<GithubCredentialRecord | null> => {
  const trimmed = slackUserId.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const db = await getDB();
  const credential = await db.query.githubCredentials.findFirst({
    where: eq(githubCredentials.slack_user_id, trimmed),
  });

  if (!credential) {
    return null;
  }

  return {
    id: credential.id,
    userId: credential.user_id ?? null,
    slackUserId: credential.slack_user_id,
    accessToken: credential.access_token ?? null,
    refreshToken: credential.refresh_token ?? null,
    tokenExpiresAt: credential.token_expires_at,
    createdAt: credential.created_at,
    updatedAt: credential.updated_at,
  };
};

export const upsertGithubCredential = async ({
  slackUserId,
  accessToken,
  refreshToken,
  tokenExpiresAt,
}: {
  slackUserId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}): Promise<void> => {
  const normalizedSlackUserId = slackUserId.trim();
  if (normalizedSlackUserId.length === 0) {
    throw new Error("Slack 사용자 ID가 비어 있어 GitHub 자격 증명을 저장할 수 없습니다.");
  }

  const db = await getDB();
  const existing = await db.query.githubCredentials.findFirst({
    where: eq(githubCredentials.slack_user_id, normalizedSlackUserId),
  });

  const persistedUserId = existing?.user_id ?? null;

  if (existing) {
    await db
      .update(githubCredentials)
      .set({
        user_id: persistedUserId,
        slack_user_id: normalizedSlackUserId,
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        token_expires_at: tokenExpiresAt ?? null,
      })
      .where(eq(githubCredentials.id, existing.id));
    return;
  }

  await db.insert(githubCredentials).values({
    user_id: persistedUserId,
    slack_user_id: normalizedSlackUserId,
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    token_expires_at: tokenExpiresAt ?? null,
  });
};
