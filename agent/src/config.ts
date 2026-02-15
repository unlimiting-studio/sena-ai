import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";
import { getAgentConfigBaseDir, getAgentRuntimeConfig } from "./agentConfig.ts";

loadDotenv();

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSlackVerifyMode = (value: string | undefined): "agent" | "external" => {
  if (!value) {
    return "agent";
  }
  return value.trim().toLowerCase() === "external" ? "external" : "agent";
};

const normalizeAgentRuntimeMode = (value: string | undefined): "claude" | "codex" => {
  if (!value) {
    return "claude";
  }
  return value.trim().toLowerCase() === "codex" ? "codex" : "claude";
};

const expandHomePath = (candidatePath: string): string => {
  if (candidatePath === "~") {
    return os.homedir();
  }
  if (candidatePath.startsWith("~/")) {
    return path.join(os.homedir(), candidatePath.slice(2));
  }
  return candidatePath;
};

const resolveWorkspaceDir = (value: string | null): string => {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return path.join(fs.realpathSync(os.tmpdir()), "sena-workspaces");
  }

  const expanded = expandHomePath(trimmed);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.resolve(getAgentConfigBaseDir(), expanded);
};

const AGENT_RUNTIME_CONFIG = getAgentRuntimeConfig();
const RESOLVED_WORKSPACE_DIR = resolveWorkspaceDir(AGENT_RUNTIME_CONFIG.cwd);

export const CONFIG = {
  PORT: toInt(process.env.PORT, 22481),
  NODE_ENV: process.env.NODE_ENV || "development",
  BACKEND_URL: process.env.BACKEND_URL || "http://localhost:22481",
  DATABASE_URL: process.env.DATABASE_URL || "mysql://user:password@localhost:3306/karby_agent",
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || "",
  AGENT_RUNTIME_MODE: normalizeAgentRuntimeMode(
    process.env.AGENT_RUNTIME_MODE ?? AGENT_RUNTIME_CONFIG.mode ?? undefined,
  ),
  AGENT_MODEL: process.env.AGENT_MODEL || AGENT_RUNTIME_CONFIG.model || "",

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
  CODEX_API_KEY: process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",

  // Slack
  SLACK_APP_ID: process.env.SLACK_APP_ID || "",
  SLACK_TOKEN: process.env.SLACK_TOKEN || "",
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || "",
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID || "",
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET || "",
  SLACK_VERIFY_MODE: normalizeSlackVerifyMode(process.env.SLACK_VERIFY_MODE),

  // GitHub
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID || "",
  GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",

  // CouchDB (Obsidian LiveSync)
  COUCHDB_URL: process.env.COUCHDB_URL || "",
  COUCHDB_DATABASE: process.env.COUCHDB_DATABASE || "obsidian",
  COUCHDB_USER: process.env.COUCHDB_USER || "",
  COUCHDB_PASSWORD: process.env.COUCHDB_PASSWORD || "",

  // Workdir
  WORKSPACE_DIR: RESOLVED_WORKSPACE_DIR,
};

export const isProduction = (): boolean => CONFIG.NODE_ENV === "production";
