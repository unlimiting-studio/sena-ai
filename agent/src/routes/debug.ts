import { timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";

import type { FastifyInstance } from "fastify";

import { loadWorkspaceContext } from "../agents/workspaceContext.ts";
import { CONFIG } from "../config.ts";

const isDebugEnabled = (): boolean => CONFIG.INTERNAL_DEBUG_TOKEN.trim().length > 0;

const isAuthorized = (tokenHeader: unknown): boolean => {
  const expected = CONFIG.INTERNAL_DEBUG_TOKEN;
  if (expected.trim().length === 0) {
    return false;
  }
  if (typeof tokenHeader !== "string") {
    return false;
  }

  const provided = tokenHeader.trim();
  if (provided.length === 0) {
    return false;
  }

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

const canReadDir = async (dirPath: string): Promise<boolean> => {
  try {
    await fs.access(dirPath);
    return true;
  } catch {
    return false;
  }
};

export async function debugRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/internal-paths", async (request, reply) => {
    if (!isDebugEnabled()) {
      reply.code(404).send({ error: "Not found" });
      return;
    }
    if (!isAuthorized(request.headers["x-sena-debug-token"])) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    const snapshot = await loadWorkspaceContext();
    const missingFiles = snapshot.files.filter((file) => file.missing).map((file) => file.relativePath);
    const truncatedFiles = snapshot.files.filter((file) => file.truncated).map((file) => file.relativePath);

    reply.send({
      ok: true,
      timestamp: new Date().toISOString(),
      process: {
        pid: process.pid,
        ppid: process.ppid,
        node: process.version,
        execPath: process.execPath,
        cwd: process.cwd(),
      },
      config: {
        port: CONFIG.PORT,
        nodeEnv: CONFIG.NODE_ENV,
        agentRuntimeMode: CONFIG.AGENT_RUNTIME_MODE,
        resolvedCwd: CONFIG.CWD,
      },
      paths: {
        resolvedCwdReadable: await canReadDir(CONFIG.CWD),
        contextDir: snapshot.contextDir,
        contextDirAbsolutePath: snapshot.contextDirAbsolutePath,
      },
      workspaceContext: {
        heartbeatInstructionEmpty: snapshot.heartbeatInstructionEmpty,
        missingCount: missingFiles.length,
        missingFiles,
        truncatedCount: truncatedFiles.length,
        truncatedFiles,
      },
    });
  });
}
