import { createHmac, timingSafeEqual } from "node:crypto";

import formbody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";
import type { FastifyRequest } from "fastify/types/request.ts";
import rawBody from "fastify-raw-body";
import { z } from "zod";

import { SlackClaudeAgent } from "../agents/slackClaudeAgent.ts";
import { CONFIG } from "../config.ts";

const slackVerificationEnabled = CONFIG.SLACK_VERIFY_MODE !== "external";

const SlackEventFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimetype: z.string().optional(),
  filetype: z.string().optional(),
  size: z.number().optional(),
  permalink: z.string().optional(),
  url_private: z.string().optional(),
  url_private_download: z.string().optional(),
});

const SlackEventSchema = z.object({
  type: z.string(),
  challenge: z.string().optional(),
  event: z
    .object({
      type: z.string(),
      text: z.string().optional(),
      user: z.string().optional(),
      channel: z.string().optional(),
      ts: z.string().optional(),
      thread_ts: z.string().optional(),
      bot_id: z.string().optional(),
      app_id: z.string().optional(),
      subtype: z.string().optional(),
      files: z.array(SlackEventFileSchema).optional(),
    })
    .optional(),
  team_id: z.string().optional(),
  token: z.string().optional(),
  api_app_id: z.string().optional(),
  event_id: z.string().optional(),
});

// Dedup cache
const processedEventIds = new Map<string, number>();
const EVENT_ID_TTL_MS = 60 * 60 * 1000;

setInterval(
  () => {
    const now = Date.now();
    for (const [eventId, ts] of processedEventIds.entries()) {
      if (now - ts > EVENT_ID_TTL_MS) {
        processedEventIds.delete(eventId);
      }
    }
  },
  5 * 60 * 1000,
).unref?.();

const verifySlackSignature = (request: FastifyRequest): boolean => {
  const signingSecret = CONFIG.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return false;
  }

  const signatureHeader = request.headers["x-slack-signature"];
  const timestampHeader = request.headers["x-slack-request-timestamp"];
  if (typeof signatureHeader !== "string" || typeof timestampHeader !== "string") {
    return false;
  }

  const timestamp = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 60 * 5) {
    return false;
  }

  const raw = request.rawBody as Buffer | string | undefined;
  if (!raw) {
    return false;
  }

  const rawString = typeof raw === "string" ? raw : raw.toString("utf8");
  const baseString = `v0:${timestamp}:${rawString}`;
  const computed = `v0=${createHmac("sha256", signingSecret).update(baseString).digest("hex")}`;

  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

const shouldAcceptEvent = (body: z.infer<typeof SlackEventSchema>): boolean => {
  if (CONFIG.SLACK_APP_ID && body.api_app_id !== CONFIG.SLACK_APP_ID) {
    return false;
  }
  if (body.type === "event_callback" && CONFIG.SLACK_TOKEN && body.token !== CONFIG.SLACK_TOKEN) {
    return false;
  }
  return true;
};

const shouldProcessEventId = (eventId: string | undefined): boolean => {
  if (!eventId) {
    return true;
  }
  if (processedEventIds.has(eventId)) {
    return false;
  }
  processedEventIds.set(eventId, Date.now());
  return true;
};

const shouldIgnoreSlackEvent = (event: z.infer<typeof SlackEventSchema>["event"]): boolean => {
  if (!event) {
    return true;
  }
  if (event.bot_id || event.app_id) {
    return true;
  }
  const subtype = event.subtype?.trim();
  if (subtype && subtype !== "thread_broadcast" && subtype !== "file_share") {
    return true;
  }
  if (!event.type) {
    return true;
  }
  if (event.type === "message") {
    const channelId = event.channel ?? "";
    if (!channelId.startsWith("D")) {
      return true;
    }
  }
  return false;
};

export async function slackRoutes(fastify: FastifyInstance) {
  await fastify.register(formbody);
  await fastify.register(rawBody, {
    field: "rawBody",
    global: false,
    runFirst: true,
  });

  fastify.post(
    "/events",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      let body: z.infer<typeof SlackEventSchema>;
      try {
        body = SlackEventSchema.parse(request.body);
      } catch {
        reply.code(400).send({ error: "Invalid payload" });
        return;
      }

      if (body.type === "url_verification" && body.challenge) {
        if (slackVerificationEnabled) {
          reply.send({ challenge: body.challenge });
        } else {
          reply.code(200).send({ ok: true });
        }
        return;
      }

      if (slackVerificationEnabled && !verifySlackSignature(request)) {
        reply.code(401).send({ error: "Invalid Slack signature" });
        return;
      }

      if (!shouldAcceptEvent(body) || !shouldProcessEventId(body.event_id)) {
        reply.code(200).send({ ok: true });
        return;
      }

      if (body.type !== "event_callback" || !body.event) {
        reply.code(200).send({ ok: true });
        return;
      }

      if (shouldIgnoreSlackEvent(body.event)) {
        reply.code(200).send({ ok: true });
        return;
      }

      const channelId = body.event.channel;
      const text = body.event.text ?? "";
      const files = body.event.files ?? [];
      if (!channelId) {
        reply.code(200).send({ ok: true });
        return;
      }

      if (text.trim().length === 0 && files.length === 0) {
        reply.code(200).send({ ok: true });
        return;
      }

      reply.code(200).send({ ok: true });

      const eventTeamId = body.team_id ?? null;
      void SlackClaudeAgent.instance.handleMention({
        teamId: eventTeamId,
        channelId,
        userId: body.event.user ?? null,
        text,
        files,
        threadTs: body.event.thread_ts ?? null,
        messageTs: body.event.ts ?? null,
      });
    },
  );

  fastify.post(
    "/interactions",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      if (slackVerificationEnabled && !verifySlackSignature(request)) {
        reply.code(401).send({ error: "Invalid Slack signature" });
        return;
      }

      const form = request.body as { payload?: string };
      const payloadString = typeof form.payload === "string" ? form.payload : null;
      if (!payloadString) {
        reply.code(400).send({ error: "Missing payload" });
        return;
      }

      const SlackInteractionPayloadSchema = z.object({
        type: z.string(),
        user: z.object({ id: z.string() }),
        channel: z.object({ id: z.string() }).optional(),
        message: z
          .object({
            ts: z.string(),
            thread_ts: z.string().optional(),
          })
          .optional(),
        actions: z
          .array(
            z.object({
              action_id: z.string(),
              value: z.string().optional(),
            }),
          )
          .optional(),
      });

      let payload: z.infer<typeof SlackInteractionPayloadSchema>;
      try {
        payload = SlackInteractionPayloadSchema.parse(JSON.parse(payloadString));
      } catch {
        reply.code(400).send({ error: "Invalid interaction payload" });
        return;
      }

      reply.code(200).send({ ok: true });

      const action = payload.actions?.[0] ?? null;
      if (!action) {
        return;
      }

      // 인터랙션 액션 핸들러는 아직 정의되지 않아 현재는 안전하게 수신 로그만 남긴다.
      fastify.log.info(
        {
          actionId: action.action_id,
          userId: payload.user.id,
          channelId: payload.channel?.id ?? null,
          messageTs: payload.message?.ts ?? null,
        },
        "Slack interaction received without registered action handler",
      );
    },
  );
}
