import { cipherDecrypt, cipherEncrypt } from "./cipher.ts";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

interface CreateGithubLinkTokenOptions {
  slackUserId: string;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  sessionId?: string | null;
  ttlMs?: number;
  issuedAt?: Date;
}

interface RawGithubLinkTokenPayload {
  v: number;
  sid: string;
  cid: string;
  tid: string | null;
  mid: string;
  ses?: string | null;
  exp: string;
  iat: string;
}

export interface GithubLinkTokenPayload {
  slackUserId: string;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  sessionId: string | null;
  expiresAt: Date;
  issuedAt: Date;
}

const normalizeString = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertNonEmpty = (value: string | null, name: string): string => {
  if (!value) {
    throw new Error(`${name}가 비어 있습니다.`);
  }
  return value;
};

export const createGithubLinkToken = ({
  slackUserId,
  channelId,
  threadTs,
  messageTs,
  sessionId,
  ttlMs = DEFAULT_TTL_MS,
  issuedAt,
}: CreateGithubLinkTokenOptions): { token: string; expiresAt: Date } => {
  const normalizedSlackUserId = assertNonEmpty(normalizeString(slackUserId), "Slack 사용자 ID");
  const normalizedChannelId = assertNonEmpty(normalizeString(channelId), "Slack 채널 ID");
  const normalizedMessageTs = assertNonEmpty(normalizeString(messageTs), "Slack 메시지 TS");
  const normalizedThreadTs = normalizeString(threadTs);
  const normalizedSessionId = normalizeString(sessionId);

  const issued = issuedAt ?? new Date();
  const expiresAt = new Date(issued.getTime() + ttlMs);

  const payload: RawGithubLinkTokenPayload = {
    v: TOKEN_VERSION,
    sid: normalizedSlackUserId,
    cid: normalizedChannelId,
    tid: normalizedThreadTs,
    mid: normalizedMessageTs,
    ses: normalizedSessionId,
    exp: expiresAt.toISOString(),
    iat: issued.toISOString(),
  };

  return {
    token: cipherEncrypt(JSON.stringify(payload)),
    expiresAt,
  };
};

const parseTimestamp = (value: string, name: string): Date => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${name}가 올바르지 않습니다.`);
  }
  return parsed;
};

export const parseGithubLinkToken = (token: string): GithubLinkTokenPayload => {
  const decrypted = cipherDecrypt(token);

  let rawPayload: RawGithubLinkTokenPayload;
  try {
    rawPayload = JSON.parse(decrypted) as RawGithubLinkTokenPayload;
  } catch (_error) {
    throw new Error("GitHub 연동 토큰을 해석할 수 없습니다.");
  }

  if (rawPayload.v !== TOKEN_VERSION) {
    throw new Error("지원하지 않는 GitHub 연동 토큰 버전입니다.");
  }

  const slackUserId = assertNonEmpty(normalizeString(rawPayload.sid), "Slack 사용자 ID");
  const channelId = assertNonEmpty(normalizeString(rawPayload.cid), "Slack 채널 ID");
  const messageTs = assertNonEmpty(normalizeString(rawPayload.mid), "Slack 메시지 TS");
  const threadTs = normalizeString(rawPayload.tid);
  const sessionId = normalizeString(rawPayload.ses);

  const expiresAt = parseTimestamp(assertNonEmpty(normalizeString(rawPayload.exp), "만료 시각"), "만료 시각");
  const issuedAt = parseTimestamp(assertNonEmpty(normalizeString(rawPayload.iat), "발급 시각"), "발급 시각");

  return {
    slackUserId,
    channelId,
    threadTs,
    messageTs,
    sessionId,
    expiresAt,
    issuedAt,
  };
};

export const isGithubLinkTokenExpired = (payload: GithubLinkTokenPayload, now: Date = new Date()): boolean =>
  payload.expiresAt.getTime() <= now.getTime();
