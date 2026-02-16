import * as http from "node:http";

import { CONFIG } from "../config.ts";
import { proxyToWorker } from "./proxy.ts";
import { installSignalRouter } from "./signalRouter.ts";
import { WorkerManager } from "./workerManager.ts";

const closeServer = async (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const listenServer = async (server: http.Server, host: string, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      host,
      port,
    });
  });

const sendJson = (
  response: http.ServerResponse<http.IncomingMessage>,
  statusCode: number,
  body: Record<string, unknown>,
): void => {
  const payload = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
};

const isLocalhostRequest = (request: http.IncomingMessage): boolean => {
  const remoteAddress = request.socket.remoteAddress;
  if (!remoteAddress) {
    return false;
  }
  if (remoteAddress === "127.0.0.1" || remoteAddress === "::1") {
    return true;
  }
  if (remoteAddress.startsWith("::ffff:")) {
    return remoteAddress.slice("::ffff:".length) === "127.0.0.1";
  }
  return false;
};

const toPathname = (requestUrl: string | undefined): string => {
  const parsed = new URL(requestUrl ?? "/", "http://127.0.0.1");
  return parsed.pathname;
};

export const startOrchestrator = async (): Promise<void> => {
  process.env.SENA_PROCESS_ROLE = "orchestrator";
  const workerManager = new WorkerManager();
  await workerManager.start();

  const server = http.createServer((request, response) => {
    void (async () => {
      const method = (request.method ?? "GET").toUpperCase();
      const pathname = toPathname(request.url);

      if (method === "GET" && (pathname === "/health" || pathname === "/__orchestrator/health")) {
        const state = workerManager.getStateSnapshot();
        sendJson(response, 200, {
          status: "ok",
          role: "orchestrator",
          pid: process.pid,
          generation: state.generation,
          activeWorker: workerManager.getActiveWorkerSnapshot(),
          restartInProgress: state.restartInProgress,
          pendingRestart: state.pendingRestart,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (method === "GET" && pathname === "/__orchestrator/state") {
        sendJson(response, 200, workerManager.getStateSnapshot());
        return;
      }

      if (method === "POST" && (pathname === "/restart" || pathname === "/__orchestrator/restart")) {
        request.resume();
        if (!isLocalhostRequest(request)) {
          sendJson(response, 403, {
            error: "forbidden",
            message: "Restart is only allowed from localhost",
          });
          return;
        }

        const restartResult = workerManager.requestRestart();
        if (!restartResult.accepted) {
          sendJson(response, 503, {
            error: "orchestrator_stopping",
            message: "Orchestrator is shutting down",
          });
          return;
        }

        const state = workerManager.getStateSnapshot();
        sendJson(response, 202, {
          accepted: true,
          queued: restartResult.queued,
          restartInProgress: true,
          pendingRestart: state.pendingRestart,
          generation: state.generation,
        });
        return;
      }

      const activeWorker = workerManager.getActiveWorkerSnapshot();
      if (!activeWorker) {
        sendJson(response, 503, {
          error: "worker_unavailable",
          message: "No active worker is available",
        });
        return;
      }

      await proxyToWorker(request, response, { targetPort: activeWorker.port });
    })().catch((error) => {
      if (response.writableEnded) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, {
        error: "orchestrator_request_failed",
        message,
      });
    });
  });

  let shuttingDown = false;
  const signalRouter = installSignalRouter(async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    signalRouter.dispose();

    console.info(`[orchestrator] graceful shutdown signal received: ${signal}`);
    server.closeIdleConnections?.();

    try {
      await closeServer(server);
    } catch {
      // no-op
    }
    await workerManager.stop();
    process.exit(0);
  });

  await listenServer(server, "0.0.0.0", CONFIG.PORT);
  console.info(`[orchestrator] started pid=${process.pid} port=${CONFIG.PORT}`);
};
