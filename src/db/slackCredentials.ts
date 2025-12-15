import { eq } from "drizzle-orm";
import { getDB } from "./connection.ts";
import { slackCredentials } from "./schema.ts";

export interface SlackCredentialRecord {
  id: number;
  userId: string;
  slackUserId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  updatedAt: Date;
  createdAt: Date;
}

export const findSlackCredentialBySlackUserId = async (slackUserId: string): Promise<SlackCredentialRecord | null> => {
  const trimmed = slackUserId.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const db = await getDB();
  const credential = await db.query.slackCredentials.findFirst({
    where: eq(slackCredentials.slack_user_id, trimmed),
  });

  if (!credential) {
    return null;
  }

  return {
    id: credential.id,
    userId: credential.user_id,
    slackUserId: credential.slack_user_id,
    accessToken: credential.access_token ?? null,
    refreshToken: credential.refresh_token ?? null,
    tokenExpiresAt: credential.token_expires_at,
    createdAt: credential.created_at,
    updatedAt: credential.updated_at,
  };
};

export const upsertSlackCredential = async (slackUserId: string, accessToken: string): Promise<void> => {
  const normalizedSlackUserId = slackUserId.trim();
  if (normalizedSlackUserId.length === 0) {
    throw new Error("Slack 사용자 ID가 비어 있어 Slack 자격 증명을 저장할 수 없습니다.");
  }

  const db = await getDB();
  const existing = await db.query.slackCredentials.findFirst({
    where: eq(slackCredentials.slack_user_id, normalizedSlackUserId),
  });

  if (existing) {
    await db
      .update(slackCredentials)
      .set({
        access_token: accessToken,
        refresh_token: null,
        token_expires_at: null,
      })
      .where(eq(slackCredentials.id, existing.id));
    return;
  }

  await db.insert(slackCredentials).values({
    user_id: normalizedSlackUserId,
    slack_user_id: normalizedSlackUserId,
    access_token: accessToken,
    refresh_token: null,
    token_expires_at: null,
  });
};
