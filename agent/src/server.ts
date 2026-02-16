import Fastify from "fastify";

import { loadWorkspaceContext } from "./agents/workspaceContext.ts";
import { startScheduledTaskScheduler } from "./agents/scheduledTaskScheduler.ts";
import { CONFIG } from "./config.ts";
import { closeDB } from "./db/connection.ts";
import { debugRoutes } from "./routes/debug.ts";
import { slackRoutes } from "./routes/slack.ts";

export type WorkerRuntimeHandle = {
  stop: () => Promise<void>;
};

export const startWorkerRuntime = async (): Promise<WorkerRuntimeHandle> => {
  const startedAt = new Date();
  const generation = Number.parseInt(process.env.SENA_WORKER_GENERATION ?? "0", 10);
  const fastify = Fastify({
    logger: {
      level: CONFIG.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  fastify.get("/health", async () => ({
    status: "ok",
    role: "worker",
    pid: process.pid,
    generation: Number.isFinite(generation) ? generation : 0,
    timestamp: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
  }));

  await fastify.register(debugRoutes, { prefix: "/api/debug" });
  await fastify.register(slackRoutes, { prefix: "/api/slack" });

  try {
    await loadWorkspaceContext();
  } catch (error) {
    fastify.log.warn({ error }, "Failed to preload workspace context");
  }

  const scheduler = await startScheduledTaskScheduler(fastify.log);

  await fastify.listen({ port: CONFIG.PORT, host: "127.0.0.1" });
  fastify.log.info(
    {
      role: "worker",
      pid: process.pid,
      generation: Number.isFinite(generation) ? generation : 0,
      port: CONFIG.PORT,
      runtimeMode: CONFIG.AGENT_RUNTIME_MODE,
    },
    "Worker server started",
  );

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    try {
      await fastify.close();
    } catch (error) {
      fastify.log.error({ error }, "Failed to close worker Fastify server");
    }
    try {
      await closeDB();
    } catch (error) {
      fastify.log.error({ error }, "Failed to close DB");
    }
    scheduler.stop();
  };

  return { stop };
};

export async function startServer(): Promise<void> {
  const runtime = await startWorkerRuntime();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.info(`[worker] graceful shutdown signal received: ${signal}`);
    await runtime.stop();
    process.exit(0);
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, () => void shutdown(signal));
  }
}
