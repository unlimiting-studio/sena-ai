/**
 * channelContext — ai-sdk LanguageModelV3Middleware
 *
 * Slack/chat-sdk turn에서 얻은 channel id를 기준으로 `channels.json`과
 * `channels/{channelId}/memory.md`를 system prompt에 합성한다.
 */

import type { LanguageModelV3CallOptions, LanguageModelV3Message } from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getTurnContext } from "../runtime/turn-context.js";

export interface ChannelContextOptions {
  /** channels.json 경로 (cwd 기준) */
  channelsFile: string;
  /** per-channel memory.md 디렉토리 (cwd 기준) */
  memoryDir: string;
  /** 상대 경로 기준. 기본값은 process.cwd(). */
  cwd?: string;
  /** channels.json 이 없을 때 앱 시작/turn을 살려야 하는 개발 모드용. 운영 기본값은 false. */
  optional?: boolean;
}

interface ChannelEntry {
  name?: string;
  description?: string;
  repositories?: string[];
  memory?: string;
  notes?: string;
}

export function channelContext(options: ChannelContextOptions): LanguageModelMiddleware {
  const cwd = options.cwd ?? process.cwd();

  return {
    specificationVersion: "v3",

    transformParams: async ({ params }) => {
      const turn = getTurnContext();
      if (!turn?.channelId) return params;

      const contextText = await loadChannelContextText(options, cwd, turn.channelId);
      if (!contextText) return params;

      return appendSystemMessage(params, contextText);
    },
  };
}

async function loadChannelContextText(
  options: ChannelContextOptions,
  cwd: string,
  channelId: string,
): Promise<string | null> {
  const channelsPath = resolveFromCwd(cwd, options.channelsFile);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(channelsPath, "utf-8"));
  } catch (err) {
    if (options.optional && isFileMissingError(err)) return null;
    throw new Error(
      `[@sena-ai/app] channelContext could not read channelsFile: ${channelsPath}. ${String(err)}`,
    );
  }

  const entry = getChannelEntry(parsed, channelId);
  const header = renderChannelHeader(channelId, entry);
  const memory = await readChannelMemory({ cwd, memoryDir: options.memoryDir, channelId, entry });

  return [header, memory ? `[channel-memory:${channelId}]\n${memory}` : null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n\n");
}

function appendSystemMessage(
  params: LanguageModelV3CallOptions,
  contextText: string,
): LanguageModelV3CallOptions {
  const prompt = params.prompt;
  const systemIndex = prompt.findIndex((message) => message.role === "system");
  if (systemIndex === -1) {
    return { ...params, prompt: [{ role: "system", content: contextText }, ...prompt] };
  }

  const nextPrompt = prompt.slice();
  const systemMessage = nextPrompt[systemIndex];
  if (systemMessage?.role !== "system") return params;
  nextPrompt[systemIndex] = {
    ...systemMessage,
    content: `${systemMessage.content}\n\n${contextText}`,
  } satisfies LanguageModelV3Message;
  return { ...params, prompt: nextPrompt };
}

function renderChannelHeader(channelId: string, entry: ChannelEntry | undefined): string {
  const lines = ["[channel-context]"];
  const displayName = entry?.name ? `#${entry.name}` : channelId;
  lines.push(`채널: ${displayName} (${channelId})`);
  if (entry?.description) lines.push(`설명: ${entry.description}`);
  if (entry?.repositories?.length) {
    lines.push(`관련 리포지토리: ${entry.repositories.join(", ")}`);
  }
  if (entry?.notes) lines.push(`메모: ${entry.notes}`);
  return lines.join("\n");
}

async function readChannelMemory(args: {
  cwd: string;
  memoryDir: string;
  channelId: string;
  entry: ChannelEntry | undefined;
}): Promise<string | null> {
  const candidates = [
    args.entry?.memory ? resolveFromCwd(args.cwd, args.entry.memory) : null,
    path.join(resolveFromCwd(args.cwd, args.memoryDir), args.channelId, "memory.md"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf-8");
    } catch (err) {
      if (!isFileMissingError(err)) {
        throw new Error(
          `[@sena-ai/app] channelContext could not read channel memory: ${candidate}. ${String(err)}`,
        );
      }
    }
  }
  return null;
}

function getChannelEntry(source: unknown, channelId: string): ChannelEntry | undefined {
  if (!isRecord(source)) return undefined;
  const channels = source.channels;
  if (isRecord(channels)) return parseChannelEntry(channels[channelId]);
  return parseChannelEntry(source[channelId]);
}

function parseChannelEntry(value: unknown): ChannelEntry | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: asString(value.name),
    description: asString(value.description),
    repositories: asStringArray(value.repositories),
    memory: asString(value.memory),
    notes: asString(value.notes),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length ? strings : undefined;
}

function resolveFromCwd(cwd: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(cwd, target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileMissingError(err: unknown): boolean {
  return isRecord(err) && err.code === "ENOENT";
}
