import { cipherDecrypt, cipherEncrypt } from "./cipher.ts";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15분

interface CreateSlackLinkTokenOptions {
  teamId: string | null;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  slackUserId: string;
  sessionId?: string | null;
  ttlMs?: number;
  issuedAt?: Date;
}

interface RawSlackLinkTokenPayload {
  v: number;
  tmid: string | null; // team id
  cid: string; // channel id
  tid: string | null; // thread ts
  mid: string; // message ts
  sid: string; // slack user id
  ses?: string | null; // session id (optional)
  exp: string; // expires at
  iat: string; // issued at
}

export interface SlackLinkTokenPayload {
  teamId: string | null;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  slackUserId: string;
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

export const createSlackLinkToken = ({
  teamId,
  channelId,
  threadTs,
  messageTs,
  slackUserId,
  sessionId,
  ttlMs = DEFAULT_TTL_MS,
  issuedAt,
}: CreateSlackLinkTokenOptions): { token: string; expiresAt: Date } => {
  const normalizedTeamId = normalizeString(teamId);
  const normalizedChannelId = assertNonEmpty(normalizeString(channelId), "Slack 채널 ID");
  const normalizedThreadTs = normalizeString(threadTs);
  const normalizedMessageTs = assertNonEmpty(normalizeString(messageTs), "Slack 메시지 TS");
  const normalizedSlackUserId = assertNonEmpty(normalizeString(slackUserId), "Slack 사용자 ID");
  const normalizedSessionId = normalizeString(sessionId);

  const issued = issuedAt ?? new Date();
  const expiresAt = new Date(issued.getTime() + ttlMs);

  const payload: RawSlackLinkTokenPayload = {
    v: TOKEN_VERSION,
    tmid: normalizedTeamId,
    cid: normalizedChannelId,
    tid: normalizedThreadTs,
    mid: normalizedMessageTs,
    sid: normalizedSlackUserId,
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

export const parseSlackLinkToken = (token: string): SlackLinkTokenPayload => {
  const decrypted = cipherDecrypt(token);

  let rawPayload: RawSlackLinkTokenPayload;
  try {
    rawPayload = JSON.parse(decrypted) as RawSlackLinkTokenPayload;
  } catch (_error) {
    throw new Error("Slack 연동 토큰을 해석할 수 없습니다.");
  }

  if (rawPayload.v !== TOKEN_VERSION) {
    throw new Error("지원하지 않는 Slack 연동 토큰 버전입니다.");
  }

  const teamId = normalizeString(rawPayload.tmid);
  const channelId = assertNonEmpty(normalizeString(rawPayload.cid), "Slack 채널 ID");
  const threadTs = normalizeString(rawPayload.tid);
  const messageTs = assertNonEmpty(normalizeString(rawPayload.mid), "Slack 메시지 TS");
  const slackUserId = assertNonEmpty(normalizeString(rawPayload.sid), "Slack 사용자 ID");
  const sessionId = normalizeString(rawPayload.ses);

  const expiresAt = parseTimestamp(assertNonEmpty(normalizeString(rawPayload.exp), "만료 시각"), "만료 시각");
  const issuedAt = parseTimestamp(assertNonEmpty(normalizeString(rawPayload.iat), "발급 시각"), "발급 시각");

  return {
    teamId,
    channelId,
    threadTs,
    messageTs,
    slackUserId,
    sessionId,
    expiresAt,
    issuedAt,
  };
};

export const isSlackLinkTokenExpired = (payload: SlackLinkTokenPayload, now: Date = new Date()): boolean =>
  payload.expiresAt.getTime() <= now.getTime();
