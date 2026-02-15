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
const DEFAULT_AGENT_ENTRY_PATH = path.join(AGENT_DIR, "sena.js");
const FALLBACK_AGENT_ENTRY_PATH = path.join(AGENT_DIR, "dist", "index.js");
const AGENT_LOG_PATH = path.join(AGENT_DIR, "nohup.out");
const AGENT_PID_PATH = path.join(AGENT_DIR, "sena.pid");
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

function parsePid(text) {
  const normalized = String(text || "").trim();
  if (!/^\d+$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function getPidFromPidFile(pidFilePath) {
  try {
    const pid = parsePid(fs.readFileSync(pidFilePath, "utf8"));
    if (!pid) {
      return null;
    }
    if (!isPidAlive(pid)) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

function findListeningPidByPort(port) {
  const normalizedPort = String(port || "").trim();
  if (!/^\d+$/u.test(normalizedPort)) {
    return null;
  }

  const result = runCommandSync("lsof", ["-t", `-iTCP:${normalizedPort}`, "-sTCP:LISTEN", "-n", "-P"]);
  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const pid = parsePid(line);
    if (pid) {
      return pid;
    }
  }

  return null;
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

function findPidsByCommandSubstring(substring) {
  const result = runCommandSync("ps", ["ax", "-o", "pid=,command="]);
  const output = result.stdout || "";
  if (!output) {
    return [];
  }

  const normalizedNeedle = substring.trim();
  if (normalizedNeedle.length === 0) {
    return [];
  }

  const pids = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const pid = match[1];
    const command = match[2] || "";
    if (command.includes(normalizedNeedle)) {
      pids.push(pid);
    }
  }

  return pids;
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

function resolveAgentEntrypoint() {
  const envEntrypoint = (process.env.SENA_RESTART_ENTRY || "").trim();
  const candidates = [
    envEntrypoint.length > 0 ? envEntrypoint : null,
    DEFAULT_AGENT_ENTRY_PATH,
    FALLBACK_AGENT_ENTRY_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(AGENT_DIR, candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
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

  const AGENT_ENTRY_PATH = resolveAgentEntrypoint();
  if (!AGENT_ENTRY_PATH) {
    console.error(`entry_not_found: ${DEFAULT_AGENT_ENTRY_PATH}`);
    process.exit(1);
  }

  const matchedPidSet = new Set();

  const pidFromFile = getPidFromPidFile(AGENT_PID_PATH);
  if (pidFromFile) {
    matchedPidSet.add(pidFromFile);
  }

  const pidFromPort = findListeningPidByPort(process.env.PORT);
  if (pidFromPort) {
    matchedPidSet.add(pidFromPort);
  }

  const entrypointCandidates = new Set([AGENT_ENTRY_PATH]);
  try {
    entrypointCandidates.add(fs.realpathSync(AGENT_ENTRY_PATH));
  } catch {
    // no-op
  }

  for (const candidate of entrypointCandidates) {
    for (const pid of findPidsByCommandSubstring(candidate)) {
      matchedPidSet.add(pid);
    }
  }

  const matchedPids = Array.from(matchedPidSet);
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

  try {
    fs.writeFileSync(AGENT_PID_PATH, `${startedPid}\n`, "utf8");
  } catch {
    // no-op
  }

  console.log(`started_pid=${startedPid}`);
}

restartAgent().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
