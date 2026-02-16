import { runCodexMcpBridgeServer } from "../mcp/codexMcpBridge.ts";
import { startWorkerRuntime } from "../server.ts";

const formatUnknown = (value: unknown): string => {
  if (value instanceof Error) {
    const stack = value.stack ?? "";
    return stack.length > 0 ? stack : `${value.name}: ${value.message}`;
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

let exitScheduled = false;

const scheduleExit = (): void => {
  if (exitScheduled) {
    return;
  }
  exitScheduled = true;
  process.exitCode = 1;
  const timer = setTimeout(() => process.exit(1), 250);
  timer.unref?.();
};

const logFatal = (label: string, value: unknown): void => {
  console.error(`[fatal] ${label}`, formatUnknown(value));
  scheduleExit();
};

process.on("uncaughtException", (error) => {
  logFatal("uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  logFatal("unhandledRejection", reason);
});

process.on("warning", (warning) => {
  const stack = warning.stack ?? "";
  const message = `${warning.name}: ${warning.message}`;
  if (stack) {
    console.warn(`[warning] ${message}\n${stack}`);
    return;
  }
  console.warn(`[warning] ${message}`);
});

const resolveCodexMcpServerNameFromArgv = (): "slack" | "obsidian" | null => {
  const index = process.argv.indexOf("--mcp-server");
  if (index < 0) {
    return null;
  }
  const name = process.argv[index + 1]?.trim() ?? "";
  if (name === "slack" || name === "obsidian") {
    return name;
  }
  throw new Error(`Unsupported MCP server name: ${name || "(empty)"}`);
};

const codexMcpServerName = resolveCodexMcpServerNameFromArgv();
if (codexMcpServerName) {
  await runCodexMcpBridgeServer(codexMcpServerName);
} else {
  const runtime = await startWorkerRuntime();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info(`[worker] graceful shutdown signal received: ${signal}`);
    await runtime.stop();
    process.exit(0);
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, () => void shutdown(signal));
  }
}
