import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv();

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const CONFIG = {
  PORT: toInt(process.env.PORT, 22481),
  NODE_ENV: process.env.NODE_ENV || "development",
  BACKEND_URL: process.env.BACKEND_URL || "http://localhost:22481",
  DATABASE_URL: process.env.DATABASE_URL || "mysql://user:password@localhost:3306/karby_agent",
  DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || "",

  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",

  // Slack
  SLACK_APP_ID: process.env.SLACK_APP_ID || "",
  SLACK_TOKEN: process.env.SLACK_TOKEN || "",
  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || "",
  SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET || "",
  SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID || "",
  SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET || "",

  // GitHub
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID || "",
  GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",

  // Workdir
  WORKSPACE_DIR: process.env.WORKSPACE_DIR || path.join(fs.realpathSync(os.tmpdir()), "sena-workspaces"),
};

export const isProduction = (): boolean => CONFIG.NODE_ENV === "production";
