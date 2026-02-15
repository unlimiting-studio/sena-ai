#!/usr/bin/env node
"use strict";

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MODULE_FILE_PATH = fileURLToPath(import.meta.url);
const INVOKED_SCRIPT_PATH = path.resolve(process.argv[1] || MODULE_FILE_PATH);
const AGENT_DIR = path.dirname(INVOKED_SCRIPT_PATH);
const RESTART_SCRIPT_PATH = INVOKED_SCRIPT_PATH;
const AGENT_ENTRY_PATH = path.join(AGENT_DIR, "sena.js");
const AGENT_LOG_PATH = path.join(AGENT_DIR, "nohup.out");
const DETACH_GUARD_ENV_KEY = "SENA_RESTART_DETACHED";
const DETACH_GUARD_VALUE = "1";
const STOP_WAIT_RETRY_COUNT = 50;
const STOP_WAIT_INTERVAL_MS = 100;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function runCommandSync(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function isPidAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function stopProcessGracefully(pid, reason) {
  if (!isPidAlive(pid)) {
    return;
  }

  console.log(`stopping_pid(${reason}): ${pid}`);
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch {
    return;
  }

  for (let i = 0; i < STOP_WAIT_RETRY_COUNT; i += 1) {
    if (!isPidAlive(pid)) {
      return;
    }
    await delay(STOP_WAIT_INTERVAL_MS);
  }

  console.log(`force_killing_pid(${reason}): ${pid}`);
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {
    // no-op
  }
}

function escapeRegexLiteral(value) {
  return value.replace(/[()[\]{}.^$*+?|\\/]/g, "\\$&");
}

function findPidsByPattern(pattern) {
  const result = runCommandSync("pgrep", ["-f", "--", pattern]);
  if (!result.stdout) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function printLogTail(logPath, lineCount) {
  try {
    const text = fs.readFileSync(logPath, "utf8");
    const lines = text.split(/\r?\n/);
    const tail = lines.slice(-lineCount);
    const output = tail.join("\n").trim();
    if (output) {
      console.error(output);
    }
  } catch {
    // no-op
  }
}

async function restartAgent() {
  // 운영 기준 경로를 고정해 .sena 기록/세션 파일이 항상 동일 위치에 생성되게 한다.
  process.chdir(AGENT_DIR);

  // 실행 중인 프로세스에서 호출되면 재시작 중간에 자기 자신이 종료될 수 있어
  // 항상 1회 분리(detached) 재실행으로 안전하게 전환한다.
  if (process.env[DETACH_GUARD_ENV_KEY] !== DETACH_GUARD_VALUE) {
    const detachedRestart = spawn(process.execPath, [RESTART_SCRIPT_PATH], {
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        [DETACH_GUARD_ENV_KEY]: DETACH_GUARD_VALUE,
      },
    });
    detachedRestart.unref();
    console.log("restart_scheduled_detached");
    process.exit(0);
  }

  if (!fs.existsSync(AGENT_ENTRY_PATH)) {
    console.error(`entry_not_found: ${AGENT_ENTRY_PATH}`);
    process.exit(1);
  }

  const escapedEntryPath = escapeRegexLiteral(AGENT_ENTRY_PATH);
  const nodeProcessPattern = `node([[:space:]].*)?[[:space:]]${escapedEntryPath}([[:space:]]|$)`;

  const matchedPids = findPidsByPattern(nodeProcessPattern);
  if (matchedPids.length > 0) {
    console.log(`stopping_pattern_matched_pids: ${matchedPids.join(" ")}`);
    for (const pid of matchedPids) {
      await stopProcessGracefully(pid, "pattern_match");
    }
  }

  const nodeExecutablePath = process.execPath;
  if (!nodeExecutablePath) {
    console.error("node_not_found_in_path");
    process.exit(1);
  }

  console.log(`starting_process: ${nodeExecutablePath} ${AGENT_ENTRY_PATH}`);
  const logFd = fs.openSync(AGENT_LOG_PATH, "a");
  const startedAgent = spawn(nodeExecutablePath, [AGENT_ENTRY_PATH], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
    },
  });
  startedAgent.unref();
  fs.closeSync(logFd);

  const startedPid = startedAgent.pid;
  await delay(200);
  if (!startedPid || !isPidAlive(startedPid)) {
    console.error("failed_to_start_process");
    printLogTail(AGENT_LOG_PATH, 50);
    process.exit(1);
  }

  console.log(`started_pid=${startedPid}`);
}

restartAgent().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
