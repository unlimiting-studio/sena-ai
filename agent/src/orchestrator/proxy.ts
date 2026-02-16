import * as http from "node:http";
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const buildUpstreamRequestHeaders = (headers: IncomingMessage["headers"], targetPort: number): OutgoingHttpHeaders => {
  const sanitized: OutgoingHttpHeaders = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (!rawKey) {
      continue;
    }
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) {
      continue;
    }
    if (key === "host") {
      continue;
    }
    sanitized[rawKey] = rawValue;
  }
  sanitized.host = `127.0.0.1:${targetPort}`;
  return sanitized;
};

const buildDownstreamResponseHeaders = (headers: http.IncomingHttpHeaders): OutgoingHttpHeaders => {
  const sanitized: OutgoingHttpHeaders = {};
  for (const [rawKey, rawValue] of Object.entries(headers)) {
    if (!rawKey) {
      continue;
    }
    const key = rawKey.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(key)) {
      continue;
    }
    sanitized[rawKey] = rawValue;
  }
  return sanitized;
};

export const proxyToWorker = async (
  request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  options: { targetPort: number },
): Promise<void> =>
  new Promise((resolve) => {
    const upstreamRequest = http.request(
      {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: options.targetPort,
        method: request.method ?? "GET",
        path: request.url ?? "/",
        headers: buildUpstreamRequestHeaders(request.headers, options.targetPort),
      },
      (upstreamResponse) => {
        const statusCode = upstreamResponse.statusCode ?? 502;
        response.writeHead(statusCode, buildDownstreamResponseHeaders(upstreamResponse.headers));
        upstreamResponse.pipe(response);
        upstreamResponse.once("end", () => {
          resolve();
        });
      },
    );

    upstreamRequest.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      }
      const payload = JSON.stringify({
        error: "worker_proxy_failed",
        message: error.message,
      });
      response.end(payload);
      resolve();
    });

    request.pipe(upstreamRequest);
  });
