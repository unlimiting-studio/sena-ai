import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { FastifyBaseLogger } from "fastify";

import {
  getAgentCronjobs,
  getAgentHeartbeat,
  getAgentMcpServers,
  getAgentName,
  type McpServerEntry,
} from "../agentConfig.ts";
import { CONFIG } from "../config.ts";
import { createSenaObsidianMcpServer } from "../mcp/obsidianMcp.ts";
import { createSenaSlackMcpServer } from "../mcp/slackMcp.ts";
import { getCouchDBClient } from "../sdks/couchdb.ts";
import { sanitizeEnv } from "../utils/env.ts";
import { createAgentRuntimeStream, type AgentRuntimeUserMessage } from "./agentRuntime.ts";
import { SYSTEM_PROMPT_APPEND } from "./slackPrompts.ts";

const SEOUL_TIME_ZONE = {
  label: "Asia/Seoul (UTC+9)",
  ianaName: "Asia/Seoul",
} as const;

const SEOUL_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SEOUL_TIME_ZONE.ianaName,
  hour12: false,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const SEOUL_DATETIME_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: SEOUL_TIME_ZONE.ianaName,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type SeoulDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
};

type CronFieldRange = {
  min: number;
  max: number;
};

type CronExpression = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
};

type SchedulerHandle = {
  stop: () => void;
};

type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  kind: "cronjob" | "heartbeat";
  expr?: CronExpression;
  heartbeatIntervalMinute?: number;
};

const CODEX_MCP_SERVER_ARG = "--mcp-server";

const WEEKDAY_TO_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const parseSeoulDateParts = (date: Date): SeoulDateParts => {
  const tokens = SEOUL_PARTS_FORMATTER.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes): string => tokens.find((part) => part.type === type)?.value ?? "";

  const weekday = getPart("weekday");
  const dayOfWeek = WEEKDAY_TO_NUMBER[weekday] ?? 0;

  const year = Number.parseInt(getPart("year"), 10);
  const month = Number.parseInt(getPart("month"), 10);
  const day = Number.parseInt(getPart("day"), 10);
  const hour = Number.parseInt(getPart("hour"), 10);
  const minute = Number.parseInt(getPart("minute"), 10);

  return {
    year: Number.isFinite(year) ? year : 1970,
    month: Number.isFinite(month) ? month : 1,
    day: Number.isFinite(day) ? day : 1,
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
    dayOfWeek,
  };
};

const formatSeoulDateTime = (date: Date): string => SEOUL_DATETIME_FORMATTER.format(date);

const toMinuteKey = (parts: SeoulDateParts): string =>
  `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(
    2,
    "0",
  )}:${String(parts.minute).padStart(2, "0")}`;

const parseCronValue = (value: string, range: CronFieldRange, options?: { normalizeDayOfWeek?: boolean }): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid cron value: ${value}`);
  }

  const normalized = options?.normalizeDayOfWeek && parsed === 7 ? 0 : parsed;
  if (normalized < range.min || normalized > range.max) {
    throw new Error(`Cron value out of range: ${value} (allowed ${range.min}-${range.max})`);
  }

  return normalized;
};

const fillRange = (
  set: Set<number>,
  start: number,
  end: number,
  step: number,
  options?: { normalizeDayOfWeek?: boolean },
): void => {
  for (let value = start; value <= end; value += step) {
    if (options?.normalizeDayOfWeek && value === 7) {
      set.add(0);
      continue;
    }
    set.add(value);
  }
};

const parseCronField = (
  field: string,
  range: CronFieldRange,
  options?: { normalizeDayOfWeek?: boolean },
): Set<number> => {
  const values = new Set<number>();
  const tokens = field.split(",").map((token) => token.trim());

  for (const token of tokens) {
    if (token.length === 0) {
      throw new Error("Empty cron token");
    }

    const [base, stepRaw] = token.split("/");
    const step = stepRaw ? Number.parseInt(stepRaw, 10) : 1;
    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${token}`);
    }

    if (base === "*") {
      fillRange(values, range.min, range.max, step, options);
      continue;
    }

    const rangeMatch = base.match(/^(\d+)-(\d+)$/u);
    if (rangeMatch) {
      const start = parseCronValue(rangeMatch[1], range, options);
      const end = parseCronValue(rangeMatch[2], range, options);
      if (start > end) {
        throw new Error(`Invalid cron range: ${base}`);
      }
      fillRange(values, start, end, step, options);
      continue;
    }

    const single = parseCronValue(base, range, options);
    values.add(single);
  }

  return values;
};

const parseCronExpression = (expr: string): CronExpression => {
  const parts = expr.trim().split(/\s+/u);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expr}`);
  }

  return {
    minute: parseCronField(parts[0], { min: 0, max: 59 }),
    hour: parseCronField(parts[1], { min: 0, max: 23 }),
    dayOfMonth: parseCronField(parts[2], { min: 1, max: 31 }),
    month: parseCronField(parts[3], { min: 1, max: 12 }),
    dayOfWeek: parseCronField(parts[4], { min: 0, max: 7 }, { normalizeDayOfWeek: true }),
  };
};

const isCronMatched = (expr: CronExpression, parts: SeoulDateParts): boolean =>
  expr.minute.has(parts.minute) &&
  expr.hour.has(parts.hour) &&
  expr.dayOfMonth.has(parts.day) &&
  expr.month.has(parts.month) &&
  expr.dayOfWeek.has(parts.dayOfWeek);

const buildSchedulerPrompt = (task: ScheduledTask): string => {
  const timestamp = formatSeoulDateTime(new Date());
  const header = task.kind === "cronjob" ? "cronjob" : "heartbeat";

  return [
    `현재시각: ${timestamp} (${SEOUL_TIME_ZONE.label})`,
    "",
    "자동 스케줄 작업이 트리거되었습니다. 아래 지시를 즉시 수행하세요.",
    "",
    `[작업 타입] ${header}`,
    `[작업 이름] ${task.name}`,
    "",
    "[사용자 프롬프트]",
    task.prompt,
  ].join("\n");
};

const singlePrompt = async function* (text: string): AsyncGenerator<AgentRuntimeUserMessage> {
  yield { text, isSynthetic: true };
};

const BRIDGE_EXEC_ARGV_BLOCKLIST = [/^--inspect(?:-brk)?(?:=.*)?$/u, /^--watch(?:=.*)?$/u];

const filterBridgeExecArgv = (argv: string[]): string[] =>
  argv.filter((arg) => !BRIDGE_EXEC_ARGV_BLOCKLIST.some((pattern) => pattern.test(arg)));

const resolveCodexBridgeEntrypoint = (): { command: string; args: string[] } => {
  const rawEntrypoint = process.argv[1]?.trim() ?? "";
  const fallbackEntrypoint = path.join(process.cwd(), "dist/index.js");
  const entrypoint = rawEntrypoint.length > 0 ? rawEntrypoint : fallbackEntrypoint;
  const resolvedEntrypoint = path.isAbsolute(entrypoint) ? entrypoint : path.resolve(process.cwd(), entrypoint);
  return {
    command: process.execPath,
    args: [...filterBridgeExecArgv(process.execArgv), resolvedEntrypoint],
  };
};

const buildSchedulerCodexSlackMcp = (): Record<string, McpServerEntry> => {
  const bridge = resolveCodexBridgeEntrypoint();
  return {
    slack: {
      command: bridge.command,
      args: [...bridge.args, CODEX_MCP_SERVER_ARG, "slack"],
      env: {
        SENA_MCP_SLACK_TEAM_ID: process.env.SENA_MCP_SLACK_TEAM_ID ?? "",
        SENA_MCP_SLACK_CHANNEL_ID: process.env.SENA_MCP_SLACK_CHANNEL_ID ?? "",
        SENA_MCP_SLACK_THREAD_TS: process.env.SENA_MCP_SLACK_THREAD_TS ?? "",
        SENA_MCP_SLACK_MESSAGE_TS: process.env.SENA_MCP_SLACK_MESSAGE_TS ?? "",
        SENA_MCP_SLACK_USER_ID: process.env.SENA_MCP_SLACK_USER_ID ?? "",
      },
    },
  };
};

const runScheduledPrompt = async (task: ScheduledTask, logger: FastifyBaseLogger): Promise<void> => {
  await fs.mkdir(CONFIG.WORKSPACE_DIR, { recursive: true });

  const env = {
    ...sanitizeEnv(process.env),
  };

  const model = (() => {
    const configured = CONFIG.AGENT_MODEL.trim();
    if (configured.length > 0) {
      return configured;
    }
    return CONFIG.AGENT_RUNTIME_MODE === "codex" ? "gpt-5-codex" : "claude-sonnet-4-5";
  })();

  const couchdbClient = getCouchDBClient();
  const abortController = new AbortController();
  const prompt = buildSchedulerPrompt(task);

  const stream =
    CONFIG.AGENT_RUNTIME_MODE === "codex"
      ? createAgentRuntimeStream({
          mode: "codex",
          prompt: singlePrompt(prompt),
          resumeSessionId: null,
          model,
          cwd: CONFIG.WORKSPACE_DIR,
          env,
          abortController,
          apiKey: CONFIG.CODEX_API_KEY,
          baseUrl: CONFIG.OPENAI_BASE_URL,
          systemPromptAppend: SYSTEM_PROMPT_APPEND,
          mcpServers: {
            ...getAgentMcpServers(),
            ...buildSchedulerCodexSlackMcp(),
          },
        })
      : createAgentRuntimeStream({
          mode: "claude",
          prompt: singlePrompt(prompt),
          resumeSessionId: null,
          model,
          cwd: CONFIG.WORKSPACE_DIR,
          env,
          abortController,
          systemPromptAppend: SYSTEM_PROMPT_APPEND,
          settingSources: ["user", "project", "local"],
          mcpServers: {
            ...getAgentMcpServers(),
            slack: createSenaSlackMcpServer({
              slack: {
                teamId: process.env.SENA_MCP_SLACK_TEAM_ID ?? null,
                channelId: process.env.SENA_MCP_SLACK_CHANNEL_ID ?? "",
                threadTs: process.env.SENA_MCP_SLACK_THREAD_TS ?? null,
                messageTs: process.env.SENA_MCP_SLACK_MESSAGE_TS ?? "",
                slackUserId: process.env.SENA_MCP_SLACK_USER_ID ?? "scheduler",
              },
              getSessionId: () => null,
            }),
            ...(couchdbClient ? { obsidian: createSenaObsidianMcpServer(couchdbClient) } : {}),
            context7: { type: "http", url: "https://mcp.context7.com/mcp" },
          },
        });

  let finalText: string | null = null;
  for await (const event of stream) {
    if (event.type === "result") {
      finalText = event.text.trim() || finalText;
    }
  }

  logger.info(
    {
      schedulerTaskId: task.id,
      schedulerTaskName: task.name,
      schedulerTaskKind: task.kind,
      finalTextPreview: finalText?.slice(0, 200) ?? null,
    },
    "Scheduled task completed",
  );
};

const toCronjobTasks = (logger: FastifyBaseLogger): ScheduledTask[] => {
  const cronjobs = getAgentCronjobs();

  const tasks: ScheduledTask[] = [];
  for (let index = 0; index < cronjobs.length; index += 1) {
    const cronjob = cronjobs[index];
    try {
      const parsed = parseCronExpression(cronjob.expr);
      tasks.push({
        id: `cronjob:${index + 1}`,
        name: cronjob.name,
        prompt: cronjob.prompt,
        kind: "cronjob",
        expr: parsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.warn(
        {
          expr: cronjob.expr,
          schedulerTaskName: cronjob.name,
          error: message,
        },
        "Skipping invalid cronjob expression",
      );
    }
  }

  return tasks;
};

const toHeartbeatTask = (logger: FastifyBaseLogger): ScheduledTask | null => {
  const heartbeat = getAgentHeartbeat();
  if (!heartbeat) {
    return null;
  }

  if (heartbeat.intervalMinute <= 0 || heartbeat.intervalMinute > 1440) {
    logger.warn({ intervalMinute: heartbeat.intervalMinute }, "Skipping invalid heartbeat intervalMinute");
    return null;
  }

  return {
    id: "heartbeat:1",
    name: "heartbeat",
    prompt: heartbeat.prompt,
    kind: "heartbeat",
    heartbeatIntervalMinute: heartbeat.intervalMinute,
  };
};

const shouldRunHeartbeatAtMinute = (parts: SeoulDateParts, intervalMinute: number): boolean => {
  const absoluteMinute = parts.hour * 60 + parts.minute;
  return absoluteMinute % intervalMinute === 0;
};

const buildRuntimeMcpServerNames = (servers: Record<string, McpServerEntry>): string[] => Object.keys(servers).sort();

export const startScheduledTaskScheduler = (logger: FastifyBaseLogger): SchedulerHandle => {
  const cronjobTasks = toCronjobTasks(logger);
  const heartbeatTask = toHeartbeatTask(logger);
  const tasks = heartbeatTask ? [...cronjobTasks, heartbeatTask] : cronjobTasks;

  if (tasks.length === 0) {
    logger.info("No scheduled tasks configured in sena.yaml");
    return { stop: () => undefined };
  }

  logger.info(
    {
      agentName: getAgentName(),
      runtimeMode: CONFIG.AGENT_RUNTIME_MODE,
      taskCount: tasks.length,
      mcpServers: buildRuntimeMcpServerNames(getAgentMcpServers()),
      tasks: tasks.map((task) => ({
        id: task.id,
        kind: task.kind,
        name: task.name,
        ...(task.kind === "cronjob" ? { expr: task.expr ? "configured" : "invalid" } : {}),
        ...(task.kind === "heartbeat" ? { intervalMinute: task.heartbeatIntervalMinute } : {}),
      })),
    },
    "Scheduled task scheduler started",
  );

  const runningTaskIds = new Set<string>();
  const executedMinuteKeyByTaskId = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;

  const scheduleNextTick = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    const now = new Date();
    const msUntilNextSecond = 1000 - now.getMilliseconds();
    timer = setTimeout(tick, msUntilNextSecond);
    timer.unref?.();
  };

  const triggerTask = (task: ScheduledTask, minuteKey: string): void => {
    if (runningTaskIds.has(task.id)) {
      logger.warn({ schedulerTaskId: task.id, schedulerTaskName: task.name }, "Skipping trigger while task is running");
      return;
    }

    runningTaskIds.add(task.id);
    executedMinuteKeyByTaskId.set(task.id, minuteKey);

    logger.info(
      {
        schedulerTaskId: task.id,
        schedulerTaskName: task.name,
        schedulerTaskKind: task.kind,
        minuteKey,
      },
      "Scheduled task triggered",
    );

    void runScheduledPrompt(task, logger)
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error(
          {
            schedulerTaskId: task.id,
            schedulerTaskName: task.name,
            schedulerTaskKind: task.kind,
            error: message,
          },
          "Scheduled task failed",
        );
      })
      .finally(() => {
        runningTaskIds.delete(task.id);
      });
  };

  const tick = (): void => {
    try {
      const now = new Date();
      const parts = parseSeoulDateParts(now);
      const minuteKey = toMinuteKey(parts);

      for (const task of tasks) {
        if (executedMinuteKeyByTaskId.get(task.id) === minuteKey) {
          continue;
        }

        const shouldTrigger =
          task.kind === "cronjob"
            ? Boolean(task.expr && isCronMatched(task.expr, parts))
            : Boolean(
                task.heartbeatIntervalMinute && shouldRunHeartbeatAtMinute(parts, task.heartbeatIntervalMinute),
              );

        if (!shouldTrigger) {
          continue;
        }

        triggerTask(task, minuteKey);
      }
    } finally {
      scheduleNextTick();
    }
  };

  scheduleNextTick();

  return {
    stop: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      runningTaskIds.clear();
      executedMinuteKeyByTaskId.clear();
    },
  };
};
