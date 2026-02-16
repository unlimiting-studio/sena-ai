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

const toOptionalInt = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

const normalizeProcessRole = (value: string | undefined): "orchestrator" | "worker" => {
  if (!value) {
    return "orchestrator";
  }
  return value.trim().toLowerCase() === "worker" ? "worker" : "orchestrator";
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

const resolveRuntimeFilePath = (value: string | undefined, fallbackPath: string): string => {
  const trimmed = value?.trim() ?? "";
  const candidate = trimmed.length > 0 ? trimmed : fallbackPath;
  const expanded = expandHomePath(candidate);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
};

const AGENT_RUNTIME_CONFIG = getAgentRuntimeConfig();
const RESOLVED_CWD = resolveWorkspaceDir(AGENT_RUNTIME_CONFIG.cwd);
const PORT_FROM_ENV_FILE = toOptionalInt(process.env.PORT);

export const CONFIG = {
  PORT: toInt(process.env.PORT, 3101),
  NODE_ENV: process.env.NODE_ENV || "development",
  BACKEND_URL: process.env.BACKEND_URL || "http://localhost:3101",
  DATABASE_URL: process.env.DATABASE_URL || "mysql://user:password@localhost:3306/karby_agent",
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || "",
  INTERNAL_DEBUG_TOKEN: process.env.SENA_INTERNAL_DEBUG_TOKEN || "",
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
  CWD: RESOLVED_CWD,
  PROCESS_ROLE: normalizeProcessRole(process.env.SENA_PROCESS_ROLE),
  WORKER_BASE_PORT: toInt(process.env.SENA_WORKER_BASE_PORT, 13101),
  WORKER_READY_TIMEOUT_MS: toInt(process.env.SENA_WORKER_READY_TIMEOUT_MS, 30000),
  WORKER_DRAIN_TIMEOUT_MS: toInt(process.env.SENA_WORKER_DRAIN_TIMEOUT_MS, 10000),
  ORCHESTRATOR_STATE_FILE: resolveRuntimeFilePath(
    process.env.SENA_ORCHESTRATOR_STATE_FILE,
    "./sena.orchestrator.state.json",
  ),
  ORCHESTRATOR_PID_FILE: resolveRuntimeFilePath(process.env.SENA_ORCHESTRATOR_PID_FILE, "./sena.orchestrator.pid"),
  WORKER_PID_FILE: resolveRuntimeFilePath(process.env.SENA_WORKER_PID_FILE, "./sena.worker.pid"),
  WORKER_ENTRYPOINT: process.env.SENA_WORKER_ENTRYPOINT?.trim() ?? "",
  PORT_FROM_ENV_FILE,
};

export const isProduction = (): boolean => CONFIG.NODE_ENV === "production";
