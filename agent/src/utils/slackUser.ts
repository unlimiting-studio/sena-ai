import { SlackSDK } from "../sdks/slack.ts";
import { isRecord } from "./object.ts";

const cachedUserNames = new Map<string, string | null>();
const inflightUserNameRequests = new Map<string, Promise<string | null>>();
const SLACK_USER_ID_PATTERN = /^[UW][A-Z0-9]+$/;

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractSlackUserName = (user: unknown): string | null => {
  if (!isRecord(user)) {
    return null;
  }

  const profile = isRecord(user.profile) ? user.profile : null;
  const candidates = [
    profile ? toNonEmptyString(profile.display_name) : null,
    profile ? toNonEmptyString(profile.real_name) : null,
    toNonEmptyString(user.real_name),
    toNonEmptyString(user.name),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

export const resolveSlackUserName = async (userId: string): Promise<string | null> => {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    return null;
  }

  if (cachedUserNames.has(normalizedUserId)) {
    return cachedUserNames.get(normalizedUserId) ?? null;
  }

  const existingRequest = inflightUserNameRequests.get(normalizedUserId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async (): Promise<string | null> => {
    try {
      const response = await SlackSDK.instance.usersInfo({ user: normalizedUserId });
      const userName = extractSlackUserName(response.user);
      cachedUserNames.set(normalizedUserId, userName);
      return userName;
    } catch {
      cachedUserNames.set(normalizedUserId, null);
      return null;
    } finally {
      inflightUserNameRequests.delete(normalizedUserId);
    }
  })();

  inflightUserNameRequests.set(normalizedUserId, request);
  return request;
};

export const formatSlackUserReference = (userId: string, userName: string | null): string => {
  const normalizedUserId = userId.trim();
  if (normalizedUserId.length === 0) {
    return "<unknown>";
  }

  const normalizedUserName = userName?.trim() ?? "";
  if (!SLACK_USER_ID_PATTERN.test(normalizedUserId)) {
    return normalizedUserName.length > 0 ? `${normalizedUserId}(${normalizedUserName})` : normalizedUserId;
  }

  if (normalizedUserName.length === 0) {
    return `<@${normalizedUserId}>`;
  }

  return `<@${normalizedUserId}>(${normalizedUserName})`;
};
