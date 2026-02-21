#!/usr/bin/env node
"use strict";

import * as fs from "node:fs";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";

const DEFAULT_PORT = 3101;

const parsePort = (value, fallback) => {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/u.test(normalized)) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const formatBodyForOutput = (rawBody) => {
  const text = rawBody.trim();
  if (text.length === 0) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
};

const resolveInvocationDir = () => {
  const rawEntrypoint = String(process.argv[1] ?? "").trim();
  if (rawEntrypoint.length === 0) {
    return process.cwd();
  }

  const resolvedEntrypoint = path.isAbsolute(rawEntrypoint)
    ? rawEntrypoint
    : path.resolve(process.cwd(), rawEntrypoint);
  return path.dirname(resolvedEntrypoint);
};

const resolveLaunchEntrypoint = (invocationDir) => {
  const localEntrypoint = path.join(invocationDir, "sena.js");
  if (fs.existsSync(localEntrypoint)) {
    return localEntrypoint;
  }
  return path.join(import.meta.dirname, "dist/index.js");
};

const INVOCATION_DIR = resolveInvocationDir();
loadDotenv({ path: path.join(INVOCATION_DIR, ".env") });

const requestRestart = async () => {
  const port = parsePort(process.env.PORT, DEFAULT_PORT);
  const endpoint = `http://127.0.0.1:${port}/restart`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const entrypoint = resolveLaunchEntrypoint(INVOCATION_DIR);
    console.log(`[restart] sena not running on ${endpoint} (${message})`);
    console.log(`[restart] starting entrypoint=${entrypoint} cwd=${INVOCATION_DIR}`);
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [entrypoint], {
      detached: true,
      stdio: "ignore",
      cwd: INVOCATION_DIR,
      env: process.env,
    });
    child.unref();
    console.log(`[restart] sena started pid=${child.pid}`);
    process.exit(0);
  }

  const rawBody = await response.text();
  const formattedBody = formatBodyForOutput(rawBody);

  if (response.ok) {
    console.log(`[restart] request_accepted endpoint=${endpoint}`);
    console.log(`[restart] status=${response.status} ${response.statusText}`);
    if (formattedBody.length > 0) {
      console.log(formattedBody);
    }
    process.exit(0);
  }

  console.error(`[restart] request_rejected endpoint=${endpoint}`);
  console.error(`[restart] status=${response.status} ${response.statusText}`);
  if (formattedBody.length > 0) {
    console.error(formattedBody);
  }
  process.exit(1);
};

void requestRestart();
