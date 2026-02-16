import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as fsPromises from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";

import { CONFIG } from "../config.ts";

const WORKER_READY_POLL_MS = 200;
const WORKER_HEALTH_TIMEOUT_MS = 1000;
const WORKER_FORCE_KILL_WAIT_MS = 3000;
const WORKER_PORT_SCAN_LIMIT = 512;

const WORKER_EXEC_ARGV_BLOCKLIST = [/^--inspect(?:-brk)?(?:=.*)?$/u, /^--watch(?:=.*)?$/u];

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const formatUnknown = (value: unknown): string => {
  if (value instanceof Error) {
    const stack = value.stack?.trim() ?? "";
    if (stack.length > 0) {
      return stack;
    }
    return `${value.name}: ${value.message}`;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeEntrypoint = (entrypoint: string): string => {
  const absolutePath = path.isAbsolute(entrypoint) ? entrypoint : path.resolve(process.cwd(), entrypoint);
  try {
    return fs.realpathSync(absolutePath);
  } catch {
    return absolutePath;
  }
};

const toGeneration = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
};

const isWorkerHealthPayload = (value: unknown, generation: number): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  if (payload.status !== "ok" || payload.role !== "worker") {
    return false;
  }
  if (typeof payload.pid !== "number" || payload.pid <= 0) {
    return false;
  }
  if (typeof payload.startedAt !== "string" || payload.startedAt.trim().length === 0) {
    return false;
  }
  return toGeneration(payload.generation) === generation;
};

const waitForChildExit = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      child.off("exit", onExit);
      clearTimeout(timeout);
    };
    const onExit = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(true);
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(false);
    }, timeoutMs);
    timeout.unref?.();
    child.once("exit", onExit);
  });
};

const canBindLoopbackPort = async (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();

    const settle = (value: boolean): void => {
      server.removeAllListeners();
      resolve(value);
    };

    server.once("error", () => settle(false));
    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          settle(false);
          return;
        }
        settle(true);
      });
    });

    server.listen({ host: "127.0.0.1", port });
  });

const resolveCandidateFromCurrentEntrypoint = (): string | null => {
  const rawEntrypoint = process.argv[1]?.trim() ?? "";
  if (rawEntrypoint.length === 0) {
    return null;
  }

  const resolvedEntrypoint = normalizeEntrypoint(rawEntrypoint);
  const extension = path.extname(resolvedEntrypoint).toLowerCase();
  if (extension === ".ts") {
    return path.join(path.dirname(resolvedEntrypoint), "worker", "index.ts");
  }
  if (extension === ".js") {
    return path.join(path.dirname(resolvedEntrypoint), "worker", "index.js");
  }
  return path.join(path.dirname(resolvedEntrypoint), "worker", "index.js");
};

const filterWorkerExecArgv = (argv: string[]): string[] =>
  argv.filter((arg) => !WORKER_EXEC_ARGV_BLOCKLIST.some((pattern) => pattern.test(arg)));

const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  const directoryPath = path.dirname(filePath);
  await fsPromises.mkdir(directoryPath, { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsPromises.writeFile(tempFilePath, content, "utf8");
  await fsPromises.rename(tempFilePath, filePath);
};

const unlinkIfExists = async (filePath: string): Promise<void> => {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT")) {
      throw error;
    }
  }
};

export type OrchestratorState = {
  orchestratorPid: number;
  activeWorkerPid: number | null;
  activeWorkerPort: number | null;
  generation: number;
  restartInProgress: boolean;
  pendingRestart: boolean;
  lastRestartAt: string | null;
  lastError: string | null;
};

export type ActiveWorkerSnapshot = {
  pid: number;
  port: number;
  generation: number;
  startedAt: string;
};

export type RestartRequestResult = {
  accepted: boolean;
  queued: boolean;
};

type WorkerRuntime = ActiveWorkerSnapshot & {
  child: ChildProcess;
};

const buildInitialState = (): OrchestratorState => ({
  orchestratorPid: process.pid,
  activeWorkerPid: null,
  activeWorkerPort: null,
  generation: 0,
  restartInProgress: false,
  pendingRestart: false,
  lastRestartAt: null,
  lastError: null,
});

const parsePersistedGeneration = (value: string): number => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const generation = toGeneration(parsed.generation);
    if (generation === null || generation < 0) {
      return 0;
    }
    return generation;
  } catch {
    return 0;
  }
};

export class WorkerManager {
  private readonly workerEntrypoint: string;
  private readonly workersByPid = new Map<number, WorkerRuntime>();
  private readonly expectedExitPids = new Set<number>();

  private state: OrchestratorState = buildInitialState();
  private activeWorker: WorkerRuntime | null = null;
  private pendingRestartRequested = false;
  private restartTask: Promise<void> | null = null;
  private stateWriteChain: Promise<void> = Promise.resolve();
  private started = false;
  private stopping = false;
  private stopTask: Promise<void> | null = null;

  constructor() {
    this.workerEntrypoint = this.resolveWorkerEntrypoint();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    this.state = buildInitialState();
    this.state.generation = await this.readPersistedGeneration();
    this.state.orchestratorPid = process.pid;

    await this.persistState();
    await this.writeOrchestratorPid();

    this.state.restartInProgress = true;
    await this.persistState();
    try {
      await this.performSingleRestart();
    } catch (error) {
      this.state.lastError = formatUnknown(error);
      await this.persistState();
      throw error;
    } finally {
      this.state.restartInProgress = false;
      this.state.pendingRestart = false;
      await this.persistState();
    }
  }

  requestRestart(): RestartRequestResult {
    if (this.stopping) {
      return { accepted: false, queued: false };
    }

    if (this.restartTask) {
      if (!this.pendingRestartRequested) {
        this.pendingRestartRequested = true;
        this.state.pendingRestart = true;
        void this.persistState();
      }
      return { accepted: true, queued: true };
    }

    this.restartTask = this.runRestartLoop().finally(() => {
      this.restartTask = null;
    });

    return { accepted: true, queued: false };
  }

  getStateSnapshot(): OrchestratorState {
    return { ...this.state };
  }

  getActiveWorkerSnapshot(): ActiveWorkerSnapshot | null {
    if (!this.activeWorker) {
      return null;
    }
    const { pid, port, generation, startedAt } = this.activeWorker;
    return { pid, port, generation, startedAt };
  }

  async stop(): Promise<void> {
    if (this.stopTask) {
      await this.stopTask;
      return;
    }

    this.stopTask = this.stopInternal();
    await this.stopTask;
  }

  private async stopInternal(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;
    this.pendingRestartRequested = false;

    if (this.restartTask) {
      try {
        await this.restartTask;
      } catch {
        // no-op
      }
    }

    const workers = [...this.workersByPid.values()];
    for (const worker of workers) {
      await this.stopWorker(worker, "orchestrator_shutdown");
    }

    this.activeWorker = null;
    this.state.activeWorkerPid = null;
    this.state.activeWorkerPort = null;
    this.state.restartInProgress = false;
    this.state.pendingRestart = false;

    await this.writeWorkerPid(null);
    await this.persistState();
    await unlinkIfExists(CONFIG.ORCHESTRATOR_PID_FILE);
  }

  private resolveWorkerEntrypoint(): string {
    const configuredEntrypoint = CONFIG.WORKER_ENTRYPOINT.trim();
    if (configuredEntrypoint.length > 0) {
      return normalizeEntrypoint(configuredEntrypoint);
    }

    const fromCurrentEntrypoint = resolveCandidateFromCurrentEntrypoint();
    const fallbackDistEntrypoint = path.resolve(process.cwd(), "dist/worker/index.js");

    if (fromCurrentEntrypoint && fs.existsSync(fromCurrentEntrypoint)) {
      return fromCurrentEntrypoint;
    }
    if (fs.existsSync(fallbackDistEntrypoint)) {
      return fallbackDistEntrypoint;
    }
    if (fromCurrentEntrypoint) {
      return fromCurrentEntrypoint;
    }
    return fallbackDistEntrypoint;
  }

  private async readPersistedGeneration(): Promise<number> {
    try {
      const raw = await fsPromises.readFile(CONFIG.ORCHESTRATOR_STATE_FILE, "utf8");
      return parsePersistedGeneration(raw);
    } catch {
      return 0;
    }
  }

  private async writeOrchestratorPid(): Promise<void> {
    await writeFileAtomic(CONFIG.ORCHESTRATOR_PID_FILE, `${process.pid}\n`);
  }

  private async writeWorkerPid(pid: number | null): Promise<void> {
    if (pid === null) {
      await unlinkIfExists(CONFIG.WORKER_PID_FILE);
      return;
    }
    await writeFileAtomic(CONFIG.WORKER_PID_FILE, `${pid}\n`);
  }

  private async persistState(): Promise<void> {
    const snapshot: OrchestratorState = { ...this.state };
    this.stateWriteChain = this.stateWriteChain
      .catch(() => undefined)
      .then(async () => {
        await writeFileAtomic(CONFIG.ORCHESTRATOR_STATE_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
      });
    await this.stateWriteChain;
  }

  private async runRestartLoop(): Promise<void> {
    while (!this.stopping) {
      this.pendingRestartRequested = false;
      this.state.restartInProgress = true;
      this.state.pendingRestart = false;
      await this.persistState();

      try {
        await this.performSingleRestart();
        this.state.lastError = null;
      } catch (error) {
        this.state.lastError = formatUnknown(error);
        console.error("[orchestrator] restart failed", this.state.lastError);
      }

      this.state.restartInProgress = false;
      this.state.pendingRestart = this.pendingRestartRequested;
      await this.persistState();

      if (!this.pendingRestartRequested) {
        break;
      }
    }
  }

  private async performSingleRestart(): Promise<void> {
    if (this.stopping) {
      throw new Error("orchestrator_stopping");
    }

    const previousWorker = this.activeWorker;
    const nextGeneration = this.state.generation + 1;
    const nextPort = await this.resolveNextWorkerPort(nextGeneration);
    const candidateWorker = await this.launchWorker(nextGeneration, nextPort);

    try {
      await this.waitForWorkerReady(candidateWorker);
    } catch (error) {
      await this.stopWorker(candidateWorker, "startup_failed");
      throw error;
    }

    this.activeWorker = candidateWorker;
    this.state.generation = nextGeneration;
    this.state.activeWorkerPid = candidateWorker.pid;
    this.state.activeWorkerPort = candidateWorker.port;
    this.state.lastRestartAt = new Date().toISOString();

    await this.writeWorkerPid(candidateWorker.pid);
    await this.persistState();

    if (previousWorker && previousWorker.pid !== candidateWorker.pid) {
      await this.stopWorker(previousWorker, "swapped_out");
    }
  }

  private async resolveNextWorkerPort(nextGeneration: number): Promise<number> {
    const preferredStart = CONFIG.WORKER_BASE_PORT + Math.max(0, nextGeneration - 1);
    for (let offset = 0; offset < WORKER_PORT_SCAN_LIMIT; offset += 1) {
      const candidate = preferredStart + offset;
      if (await canBindLoopbackPort(candidate)) {
        return candidate;
      }
    }
    throw new Error(`No available worker port from ${preferredStart} (scan limit=${WORKER_PORT_SCAN_LIMIT})`);
  }

  private async launchWorker(generation: number, port: number): Promise<WorkerRuntime> {
    const child = spawn(process.execPath, [...filterWorkerExecArgv(process.execArgv), this.workerEntrypoint], {
      env: {
        ...process.env,
        PORT: String(port),
        SENA_PROCESS_ROLE: "worker",
        SENA_WORKER_GENERATION: String(generation),
        SENA_WORKER_ENTRYPOINT: this.workerEntrypoint,
      },
      stdio: ["ignore", "inherit", "inherit"],
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error(`Failed to spawn worker process for entrypoint: ${this.workerEntrypoint}`);
    }

    const worker: WorkerRuntime = {
      child,
      pid,
      port,
      generation,
      startedAt: new Date().toISOString(),
    };

    this.workersByPid.set(pid, worker);
    child.once("exit", (code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    console.info(
      `[orchestrator] worker spawned pid=${pid} generation=${generation} port=${port} entrypoint=${this.workerEntrypoint}`,
    );

    return worker;
  }

  private handleWorkerExit(worker: WorkerRuntime, code: number | null, signal: NodeJS.Signals | null): void {
    this.workersByPid.delete(worker.pid);

    const expected = this.expectedExitPids.delete(worker.pid);
    if (expected) {
      return;
    }

    if (this.stopping) {
      return;
    }

    if (this.activeWorker?.pid === worker.pid) {
      this.activeWorker = null;
      this.state.activeWorkerPid = null;
      this.state.activeWorkerPort = null;
      this.state.lastError = `active_worker_exited(pid=${worker.pid}, code=${code ?? "null"}, signal=${signal ?? "null"})`;
      void this.writeWorkerPid(null);
      void this.persistState();
    }

    console.error(
      `[orchestrator] worker exited pid=${worker.pid} generation=${worker.generation} code=${code ?? "null"} signal=${
        signal ?? "null"
      }`,
    );
  }

  private async waitForWorkerReady(worker: WorkerRuntime): Promise<void> {
    const deadline = Date.now() + CONFIG.WORKER_READY_TIMEOUT_MS;
    const healthUrl = `http://127.0.0.1:${worker.port}/health`;

    while (Date.now() <= deadline) {
      if (this.stopping) {
        throw new Error("orchestrator_stopping");
      }

      if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
        throw new Error(
          `worker_exited_before_ready(pid=${worker.pid}, code=${worker.child.exitCode ?? "null"}, signal=${
            worker.child.signalCode ?? "null"
          })`,
        );
      }

      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: AbortSignal.timeout(WORKER_HEALTH_TIMEOUT_MS),
        });
        if (!response.ok) {
          await wait(WORKER_READY_POLL_MS);
          continue;
        }

        const payload: unknown = await response.json();
        if (isWorkerHealthPayload(payload, worker.generation)) {
          return;
        }
      } catch {
        // no-op
      }

      await wait(WORKER_READY_POLL_MS);
    }

    throw new Error(
      `worker_ready_timeout(pid=${worker.pid}, generation=${worker.generation}, port=${worker.port}, timeoutMs=${CONFIG.WORKER_READY_TIMEOUT_MS})`,
    );
  }

  private async stopWorker(worker: WorkerRuntime, reason: string): Promise<void> {
    if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
      return;
    }

    this.expectedExitPids.add(worker.pid);
    try {
      worker.child.kill("SIGTERM");
    } catch {
      this.expectedExitPids.delete(worker.pid);
      return;
    }

    const exitedGracefully = await waitForChildExit(worker.child, CONFIG.WORKER_DRAIN_TIMEOUT_MS);
    if (!exitedGracefully) {
      try {
        worker.child.kill("SIGKILL");
      } catch {
        // no-op
      }
      await waitForChildExit(worker.child, WORKER_FORCE_KILL_WAIT_MS);
    }

    this.expectedExitPids.delete(worker.pid);
    this.workersByPid.delete(worker.pid);

    if (this.activeWorker?.pid === worker.pid) {
      this.activeWorker = null;
      this.state.activeWorkerPid = null;
      this.state.activeWorkerPort = null;
      await this.writeWorkerPid(null);
      await this.persistState();
    }

    console.info(`[orchestrator] worker stopped pid=${worker.pid} reason=${reason}`);
  }
}
