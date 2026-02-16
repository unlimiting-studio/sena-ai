import Fastify from "fastify";

import { loadWorkspaceContext } from "./agents/workspaceContext.ts";
import { CONFIG } from "./config.ts";
import { startScheduledTaskScheduler } from "./agents/scheduledTaskScheduler.ts";
import { closeDB } from "./db/connection.ts";
import { debugRoutes } from "./routes/debug.ts";
import { slackRoutes } from "./routes/slack.ts";

export async function startServer(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: CONFIG.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  fastify.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  await fastify.register(debugRoutes, { prefix: "/api/debug" });
  await fastify.register(slackRoutes, { prefix: "/api/slack" });

  try {
    await loadWorkspaceContext();
  } catch (error) {
    fastify.log.warn({ error }, "Failed to preload workspace context");
  }

  const scheduler = await startScheduledTaskScheduler(fastify.log);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    fastify.log.info({ signal }, "Graceful shutdown signal received");
    try {
      await fastify.close();
    } catch (error) {
      fastify.log.error({ error }, "Failed to close Fastify server");
    }
    try {
      await closeDB();
    } catch (error) {
      fastify.log.error({ error }, "Failed to close DB");
    }
    scheduler.stop();
    process.exit(0);
  };

  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.once(signal, () => void shutdown(signal));
  }

  await fastify.listen({ port: CONFIG.PORT, host: "0.0.0.0" });
  fastify.log.info(`agent-sdk 서버가 포트 ${CONFIG.PORT}에서 실행 중입니다. (mode=${CONFIG.AGENT_RUNTIME_MODE})`);
}
