import { Container, getContainer } from "@cloudflare/containers";

const DEFAULT_CONTAINER_ID = "sena-agent-default";
const SLACK_EVENTS_PATH = "/api/slack/events";
const SLACK_INTERACTIONS_PATH = "/api/slack/interactions";
const SLACK_OAUTH_PATHS = new Set(["/api/auth/slack/start", "/api/auth/slack/callback"]);
const GITHUB_OAUTH_PATHS = new Set(["/api/auth/github/start", "/api/auth/github/callback"]);
const NON_ENCRYPTED_TEXT_LENGTH = 28;
const AUTH_TAG_LENGTH = 16;

const buildThreadContainerId = (channelId, threadTs) => `${channelId}:${threadTs}`;

const decodeBase64 = (value) => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("empty_base64");
  }
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

let cachedKey = null;
let cachedKeySource = "";

const getCryptoKey = async (base64Key) => {
  if (cachedKey && cachedKeySource === base64Key) {
    return cachedKey;
  }
  const rawKey = decodeBase64(base64Key);
  if (rawKey.length !== 32) {
    throw new Error("invalid_key_length");
  }
  cachedKeySource = base64Key;
  cachedKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  return cachedKey;
};

const decryptTokenPayload = async (token, env) => {
  const secret = env.DATA_ENCRYPTION_KEY ?? "";
  if (!secret) {
    return null;
  }
  const bytes = decodeBase64(token);
  if (bytes.length <= NON_ENCRYPTED_TEXT_LENGTH) {
    return null;
  }

  const ivStart = bytes.length - NON_ENCRYPTED_TEXT_LENGTH;
  const tagStart = bytes.length - AUTH_TAG_LENGTH;
  const encrypted = bytes.slice(0, ivStart);
  const iv = bytes.slice(ivStart, tagStart);
  const tag = bytes.slice(tagStart);

  const cipherText = new Uint8Array(encrypted.length + tag.length);
  cipherText.set(encrypted, 0);
  cipherText.set(tag, encrypted.length);

  const key = await getCryptoKey(secret);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);
  return new TextDecoder().decode(plainBuffer);
};

const extractThreadFromEncryptedState = async (state, env) => {
  if (!state) {
    return null;
  }
  try {
    const decrypted = await decryptTokenPayload(state, env);
    if (!decrypted) {
      return null;
    }
    const payload = JSON.parse(decrypted);
    const channelId = typeof payload?.cid === "string" ? payload.cid : null;
    const messageTs = typeof payload?.mid === "string" ? payload.mid : null;
    const threadTs = typeof payload?.tid === "string" ? payload.tid : null;
    if (!channelId || !messageTs) {
      return null;
    }
    return { channelId, threadTs: threadTs || messageTs };
  } catch {
    return null;
  }
};

const extractThreadFromSlackEvent = (rawBody) => {
  try {
    const body = JSON.parse(rawBody);
    const event = body?.event ?? null;
    const channelId = typeof event?.channel === "string" ? event.channel : null;
    const messageTs = typeof event?.ts === "string" ? event.ts : null;
    const threadTs = typeof event?.thread_ts === "string" ? event.thread_ts : null;
    if (!channelId || !messageTs) {
      return null;
    }
    return { channelId, threadTs: threadTs || messageTs };
  } catch {
    return null;
  }
};

const extractThreadFromSlackInteraction = (rawBody) => {
  try {
    const params = new URLSearchParams(rawBody);
    const payloadString = params.get("payload");
    if (!payloadString) {
      return null;
    }
    const payload = JSON.parse(payloadString);
    const channelId = typeof payload?.channel?.id === "string" ? payload.channel.id : null;
    const messageTs = typeof payload?.message?.ts === "string" ? payload.message.ts : null;
    const threadTs = typeof payload?.message?.thread_ts === "string" ? payload.message.thread_ts : null;
    if (!channelId || !messageTs) {
      return null;
    }
    return { channelId, threadTs: threadTs || messageTs };
  } catch {
    return null;
  }
};

const resolveContainerId = async (request, env) => {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === SLACK_EVENTS_PATH && request.method === "POST") {
    const rawBody = await request.clone().text();
    const thread = extractThreadFromSlackEvent(rawBody);
    if (thread) {
      return buildThreadContainerId(thread.channelId, thread.threadTs);
    }
    return DEFAULT_CONTAINER_ID;
  }

  if (pathname === SLACK_INTERACTIONS_PATH && request.method === "POST") {
    const rawBody = await request.clone().text();
    const thread = extractThreadFromSlackInteraction(rawBody);
    if (thread) {
      return buildThreadContainerId(thread.channelId, thread.threadTs);
    }
    return DEFAULT_CONTAINER_ID;
  }

  if (SLACK_OAUTH_PATHS.has(pathname) || GITHUB_OAUTH_PATHS.has(pathname)) {
    const state = url.searchParams.get("state") ?? url.searchParams.get("token") ?? "";
    const thread = await extractThreadFromEncryptedState(state, env);
    if (thread) {
      return buildThreadContainerId(thread.channelId, thread.threadTs);
    }
    return DEFAULT_CONTAINER_ID;
  }

  return DEFAULT_CONTAINER_ID;
};

export class SenaAgentContainer extends Container {
  defaultPort = 22481;
  sleepAfter = "10m";
  enableInternet = true;

  envVars = {
    NODE_ENV: this.env.NODE_ENV ?? "production",
    PORT: "22481",
    BACKEND_URL: this.env.BACKEND_URL ?? "",
    DATABASE_URL: this.env.DATABASE_URL ?? "",
    DATA_ENCRYPTION_KEY: this.env.DATA_ENCRYPTION_KEY ?? "",
    ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY ?? "",
    SLACK_APP_ID: this.env.SLACK_APP_ID ?? "",
    SLACK_TOKEN: this.env.SLACK_TOKEN ?? "",
    SLACK_BOT_TOKEN: this.env.SLACK_BOT_TOKEN ?? "",
    SLACK_SIGNING_SECRET: this.env.SLACK_SIGNING_SECRET ?? "",
    SLACK_CLIENT_ID: this.env.SLACK_CLIENT_ID ?? "",
    SLACK_CLIENT_SECRET: this.env.SLACK_CLIENT_SECRET ?? "",
    GITHUB_OAUTH_CLIENT_ID: this.env.GITHUB_OAUTH_CLIENT_ID ?? "",
    GITHUB_OAUTH_CLIENT_SECRET: this.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
    WORKSPACE_DIR: this.env.WORKSPACE_DIR ?? "",
  };
}

export default {
  async fetch(request, env) {
    const containerId = await resolveContainerId(request, env);
    const container = getContainer(env.SENA_AGENT, containerId);
    return container.fetch(request);
  },
};
