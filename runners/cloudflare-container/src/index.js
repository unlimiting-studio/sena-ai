import { Container, getContainer } from "@cloudflare/containers";

const DEFAULT_CONTAINER_ID = "sena-agent-default";
const AGENT_PATH_PREFIX = "/api/agents/";
const SLACK_EVENTS_PATH = "/api/slack/events";
const SLACK_INTERACTIONS_PATH = "/api/slack/interactions";
const SLACK_OAUTH_PATHS = new Set(["/api/auth/slack/start", "/api/auth/slack/callback"]);
const GITHUB_OAUTH_PATHS = new Set(["/api/auth/github/start", "/api/auth/github/callback"]);
const SLACK_SIGNATURE_HEADER = "x-slack-signature";
const SLACK_TIMESTAMP_HEADER = "x-slack-request-timestamp";
const SLACK_TIMESTAMP_TOLERANCE_SECONDS = 60 * 5;
const NON_ENCRYPTED_TEXT_LENGTH = 28;
const AUTH_TAG_LENGTH = 16;
const AGENT_CONFIG_TABLE = "agent_configs";

const buildAgentPrefix = (agentId) => `agent:${encodeURIComponent(agentId)}`;

const buildThreadContainerId = (agentId, channelId, threadTs) => {
  if (agentId) {
    return `${buildAgentPrefix(agentId)}:${channelId}:${threadTs}`;
  }
  return `${channelId}:${threadTs}`;
};

const buildDefaultContainerId = (agentId) => {
  if (agentId) {
    return `${buildAgentPrefix(agentId)}:default`;
  }
  return DEFAULT_CONTAINER_ID;
};

const parseAgentRoute = (pathname) => {
  if (!pathname.startsWith(AGENT_PATH_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(AGENT_PATH_PREFIX.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0) {
    return null;
  }
  const rawAgentId = rest.slice(0, slashIndex);
  let agentId = null;
  try {
    agentId = decodeURIComponent(rawAgentId);
  } catch {
    return null;
  }
  const remainder = rest.slice(slashIndex + 1);
  const normalizedRemainder = remainder.startsWith("api/") ? remainder : `api/${remainder}`;
  const agentPath = `/${normalizedRemainder}`;
  if (!agentPath || agentPath === "/") {
    return null;
  }
  return { agentId, agentPath };
};

const isSlackPath = (pathname) => pathname === SLACK_EVENTS_PATH || pathname === SLACK_INTERACTIONS_PATH;

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

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

let cachedSlackKey = null;
let cachedSlackKeySource = "";

const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const toHex = (bytes) => {
  let output = "";
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }
  return output;
};

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

const getSlackHmacKey = async (secret) => {
  if (cachedSlackKey && cachedSlackKeySource === secret) {
    return cachedSlackKey;
  }
  cachedSlackKeySource = secret;
  cachedSlackKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return cachedSlackKey;
};

const normalizeDbText = (value) => (typeof value === "string" ? value : "");

const substituteEnvVarsInYaml = (yaml, env) =>
  yaml.replace(/\{\{(\w+)\}\}/g, (_, key) => env[key] ?? "");

const loadAgentConfig = async (agentId, env) => {
  const database = env.SENA_APPS;
  if (!database) {
    return { error: "missing_sena_apps_binding" };
  }
  const row = await database
    .prepare(
      `SELECT slack_app_id, slack_token, slack_bot_token, slack_signing_secret, github_token, sena_yaml
       FROM ${AGENT_CONFIG_TABLE}
       WHERE agent_id = ?`
    )
    .bind(agentId)
    .first();
  console.log("row", row);
  if (!row) {
    return { error: "agent_not_found" };
  }
  return {
    config: {
      slackAppId: normalizeDbText(row.slack_app_id),
      slackToken: normalizeDbText(row.slack_token),
      slackBotToken: normalizeDbText(row.slack_bot_token),
      slackSigningSecret: normalizeDbText(row.slack_signing_secret),
      githubToken: normalizeDbText(row.github_token),
      senaYaml: normalizeDbText(row.sena_yaml),
    },
  };
};

const verifySlackSignature = async (rawBody, headers, signingSecret) => {
  if (!signingSecret) {
    return false;
  }
  const timestampHeader = headers.get(SLACK_TIMESTAMP_HEADER);
  const signatureHeader = headers.get(SLACK_SIGNATURE_HEADER);
  if (!timestampHeader || !signatureHeader) {
    return false;
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SLACK_TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const key = await getSlackHmacKey(signingSecret);
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const computed = `v0=${toHex(new Uint8Array(signatureBytes))}`;

  return timingSafeEqual(computed, signatureHeader);
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

const maybeHandleSlackRequest = async ({ request, rawBody, slackPath, signingSecret }) => {
  if (request.method !== "POST") {
    return null;
  }

  if (!isSlackPath(slackPath)) {
    return null;
  }

  const isValid = await verifySlackSignature(rawBody, request.headers, signingSecret);
  if (!isValid) {
    return jsonResponse({ error: "Invalid Slack signature" }, 401);
  }

  if (slackPath === SLACK_EVENTS_PATH) {
    try {
      const payload = JSON.parse(rawBody);
      if (payload?.type === "url_verification" && typeof payload.challenge === "string") {
        return jsonResponse({ challenge: payload.challenge }, 200);
      }
    } catch {
      return null;
    }
  }

  return null;
};

const resolveContainerId = async ({ request, env, rawBody, agentId, effectivePath }) => {
  const url = new URL(request.url);

  if (effectivePath === SLACK_EVENTS_PATH && request.method === "POST") {
    const payload = rawBody ?? (await request.clone().text());
    const thread = extractThreadFromSlackEvent(payload);
    if (thread) {
      return buildThreadContainerId(agentId, thread.channelId, thread.threadTs);
    }
    return buildDefaultContainerId(agentId);
  }

  if (effectivePath === SLACK_INTERACTIONS_PATH && request.method === "POST") {
    const payload = rawBody ?? (await request.clone().text());
    const thread = extractThreadFromSlackInteraction(payload);
    if (thread) {
      return buildThreadContainerId(agentId, thread.channelId, thread.threadTs);
    }
    return buildDefaultContainerId(agentId);
  }

  if (SLACK_OAUTH_PATHS.has(effectivePath) || GITHUB_OAUTH_PATHS.has(effectivePath)) {
    const state = url.searchParams.get("state") ?? url.searchParams.get("token") ?? "";
    const thread = await extractThreadFromEncryptedState(state, env);
    if (thread) {
      return buildThreadContainerId(agentId, thread.channelId, thread.threadTs);
    }
    return buildDefaultContainerId(agentId);
  }

  return buildDefaultContainerId(agentId);
};

const buildContainerEnvVars = (env, agentConfig) => ({
  NODE_ENV: env.NODE_ENV ?? "production",
  PORT: "22481",
  BACKEND_URL: env.BACKEND_URL ?? "",
  DATABASE_URL: env.DATABASE_URL ?? "",
  DATA_ENCRYPTION_KEY: env.DATA_ENCRYPTION_KEY ?? "",
  ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ?? "",
  SLACK_APP_ID: agentConfig?.slackAppId ?? "",
  SLACK_TOKEN: agentConfig?.slackToken ?? "",
  SLACK_BOT_TOKEN: agentConfig?.slackBotToken ?? "",
  SLACK_SIGNING_SECRET: agentConfig?.slackSigningSecret ?? "",
  SLACK_CLIENT_ID: env.SLACK_CLIENT_ID ?? "",
  SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET ?? "",
  SLACK_VERIFY_MODE: env.SLACK_VERIFY_MODE ?? "",
  GITHUB_OAUTH_CLIENT_ID: env.GITHUB_OAUTH_CLIENT_ID ?? "",
  GITHUB_OAUTH_CLIENT_SECRET: env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
  GITHUB_TOKEN: agentConfig?.githubToken ?? "",
  WORKSPACE_DIR: env.WORKSPACE_DIR ?? "",
  SENA_YAML: substituteEnvVarsInYaml(agentConfig?.senaYaml ?? "", env),
});

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
    SLACK_VERIFY_MODE: this.env.SLACK_VERIFY_MODE ?? "",
    GITHUB_OAUTH_CLIENT_ID: this.env.GITHUB_OAUTH_CLIENT_ID ?? "",
    GITHUB_OAUTH_CLIENT_SECRET: this.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
    GITHUB_TOKEN: this.env.GITHUB_TOKEN ?? "",
    WORKSPACE_DIR: this.env.WORKSPACE_DIR ?? "",
    SENA_YAML: this.env.SENA_YAML ?? "",
    CONTAINER_ID: this.id ?? "",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const agentRoute = parseAgentRoute(url.pathname);
    const effectivePath = agentRoute?.agentPath ?? url.pathname;
    const shouldInspectSlack = request.method === "POST" && isSlackPath(effectivePath);

    let rawBody = null;
    let agentConfig = null;
    if (shouldInspectSlack) {
      rawBody = await request.clone().text();
      let signingSecret = env.SLACK_SIGNING_SECRET ?? "";
      if (agentRoute) {
        const agentResult = await loadAgentConfig(agentRoute.agentId, env);
        if (agentResult.error) {
          const status = agentResult.error === "agent_not_found" ? 404 : 500;
          return jsonResponse({ error: agentResult.error }, status);
        }
        agentConfig = agentResult.config;
        signingSecret = agentConfig.slackSigningSecret;
      }
      const slackResponse = await maybeHandleSlackRequest({
        request,
        rawBody,
        slackPath: effectivePath,
        signingSecret,
      });
      if (slackResponse) {
        return slackResponse;
      }
    }

    if (agentRoute && !agentConfig) {
      const agentResult = await loadAgentConfig(agentRoute.agentId, env);
      if (agentResult.error) {
        const status = agentResult.error === "agent_not_found" ? 404 : 500;
        return jsonResponse({ error: agentResult.error }, status);
      }
      agentConfig = agentResult.config;
    }

    const containerId = await resolveContainerId({
      request,
      env,
      rawBody,
      agentId: agentRoute?.agentId ?? null,
      effectivePath,
    });
    const container = getContainer(env.SENA_AGENT, containerId);
    if (agentRoute) {
      await container.startAndWaitForPorts({
        startOptions: {
          envVars: buildContainerEnvVars(env, agentConfig),
        },
      });
    }

    if (!agentRoute) {
      return container.fetch(request);
    }

    const targetUrl = new URL(request.url);
    targetUrl.pathname = agentRoute.agentPath;
    const containerRequest = new Request(targetUrl, request);
    return container.fetch(containerRequest);
  },
};
