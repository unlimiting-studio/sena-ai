import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { Block, KnownBlock } from "@slack/types";
import { z } from "zod";

import { CONFIG } from "../config.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { formatSlackUserReference, resolveSlackUserName } from "../utils/slackUser.ts";

export type SlackToolsContext = Record<string, never>;

const textContent = (text: string) => ({ type: "text" as const, text });

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const formatSlackMessage = async (msg: unknown): Promise<string | null> => {
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const record = msg as Record<string, unknown>;
  const ts = toNonEmptyString(record.ts) ?? "unknown";
  const userId = toNonEmptyString(record.user);
  const text = toNonEmptyString(record.text) ?? "";
  const userName = userId ? await resolveSlackUserName(userId) : null;
  const author = userId ? formatSlackUserReference(userId, userName) : "<unknown>";
  return `[${ts}] ${author}: ${text}`;
};

const GetMessagesSchema = z.object({
  mode: z.enum(["thread", "channel"]).default("thread"),
  channelId: z.string().min(1).describe("대상 채널 ID (필수)"),
  threadTs: z.string().optional().describe("mode=thread일 때 대상 thread ts (필수)"),
  limit: z.number().int().min(1).max(100).default(20),
  latest: z.string().optional(),
  oldest: z.string().optional(),
});

const ListChannelsSchema = z.object({
  types: z
    .string()
    .default("public_channel,private_channel")
    .describe("conversations.list types (CSV). 예: public_channel,private_channel / public_channel / private_channel"),
  excludeArchived: z.boolean().default(true).describe("아카이브 채널 제외 여부"),
  limit: z.number().int().min(1).max(1000).default(200).describe("페이지당 최대 채널 수"),
  cursor: z.string().optional().describe("페이지네이션 커서(옵셔널)"),
  maxPages: z.number().int().min(1).max(20).default(5).describe("최대 페이지 수(안전장치)"),
});

const PostMessageSchema = z.object({
  text: z.string().optional().describe("전송할 메시지 텍스트 (옵셔널, blocks 없이 보낼 때는 필수)"),
  blocks: z
    .array(
      // Codex MCP bridge needs schemas convertible to JSON Schema.
      z.record(z.string(), z.unknown()),
    )
    .optional()
    .describe("Slack blocks 배열 (옵셔널, text 없이 보낼 때는 필수)"),
  channelId: z.string().min(1).describe("대상 채널 ID (필수)"),
  threadTs: z.string().optional().describe("대상 thread ts (옵셔널)"),
});

const DownloadFileSchema = z.object({
  fileId: z.string().describe("Slack 파일 ID (예: F07ABCDEF12)"),
});

type GetMessagesArgs = z.infer<typeof GetMessagesSchema>;
type ListChannelsArgs = z.infer<typeof ListChannelsSchema>;
type PostMessageArgs = z.infer<typeof PostMessageSchema>;
type DownloadFileArgs = z.infer<typeof DownloadFileSchema>;

const GET_MESSAGES_DESCRIPTION = "Slack 채널/쓰레드 메시지를 읽어옵니다.";
const LIST_CHANNELS_DESCRIPTION = "Slack 채널 목록을 조회합니다.";
const POST_MESSAGE_DESCRIPTION =
  "Slack 채널/쓰레드에 메시지를 남깁니다. 일상적인 '응답' 의미로는 사용하지 말고, 현재 작업과 무관한 다른 채널/스레드에 알림이나 메모를 남길 때만 사용하세요.";
const DOWNLOAD_FILE_DESCRIPTION =
  "Slack 파일을 다운로드합니다. 파일 ID를 받아 로컬 워크스페이스에 저장하고 경로를 반환합니다.";

const handleGetMessages = async (args: GetMessagesArgs) => {
  const channelId = args.channelId.trim();
  const mode = args.mode;
  const threadTs = args.threadTs?.trim() ?? "";

  if (channelId.length === 0) {
    return {
      content: [textContent("메시지 조회 실패: channelId를 지정해 주세요.")],
      isError: true,
    };
  }
  if (mode === "thread" && threadTs.length === 0) {
    return {
      content: [textContent("메시지 조회 실패: thread 모드에서는 threadTs가 필요합니다.")],
      isError: true,
    };
  }

  const response =
    mode === "thread"
      ? await SlackSDK.instance.getThreadReplies({
          channel: channelId,
          ts: threadTs,
          limit: args.limit,
          latest: args.latest,
          oldest: args.oldest,
        })
      : await SlackSDK.instance.getChannelHistory({
          channel: channelId,
          limit: args.limit,
          latest: args.latest,
          oldest: args.oldest,
        });

  const messages = toArray(response.messages);
  const lines: string[] = [];
  for (const message of messages) {
    const line = await formatSlackMessage(message);
    if (line) {
      lines.push(line);
    }
  }
  const header = `Slack messages (${mode}). count=${lines.length}`;
  const body = lines.length > 0 ? lines.join("\n") : "(no messages)";

  return {
    content: [textContent(`${header}\n\n${body}`)],
  };
};

const extractNextCursor = (responseMetadata: unknown): string | null => {
  if (!responseMetadata || typeof responseMetadata !== "object") {
    return null;
  }
  const record = responseMetadata as Record<string, unknown>;
  return toNonEmptyString(record.next_cursor);
};

const formatChannelLine = (channel: unknown): string | null => {
  if (!channel || typeof channel !== "object") {
    return null;
  }

  const record = channel as Record<string, unknown>;
  const id = toNonEmptyString(record.id);
  const name = toNonEmptyString(record.name);
  const isPrivate = typeof record.is_private === "boolean" ? record.is_private : null;
  const isMember = typeof record.is_member === "boolean" ? record.is_member : null;
  const numMembers = typeof record.num_members === "number" ? record.num_members : null;

  const topicValue =
    record.topic && typeof record.topic === "object"
      ? toNonEmptyString((record.topic as Record<string, unknown>).value)
      : null;

  if (!id) {
    return null;
  }

  const namePart = name ? `#${name}` : "(no-name)";
  const privacyPart = isPrivate === null ? "unknown" : isPrivate ? "private" : "public";
  const memberPart = isMember === null ? "?" : isMember ? "member" : "not-member";
  const membersPart = numMembers === null ? "" : ` members=${numMembers}`;
  const topicPart = topicValue ? ` topic=${topicValue}` : "";

  return `- ${id} ${namePart} (${privacyPart}, ${memberPart})${membersPart}${topicPart}`;
};

const handleListChannels = async (args: ListChannelsArgs) => {
  const types = args.types.trim();
  const cursorRaw = args.cursor?.trim() ?? "";
  const maxPages = args.maxPages;

  if (types.length === 0) {
    return {
      content: [textContent("채널 목록 조회 실패: types를 지정해 주세요.")],
      isError: true,
    };
  }

  try {
    let cursor = cursorRaw;
    let nextCursor: string | null = null;
    const channels: unknown[] = [];

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      const response = await SlackSDK.instance.listConversations({
        types,
        exclude_archived: args.excludeArchived,
        limit: args.limit,
        ...(cursor.length > 0 ? { cursor } : {}),
      });

      channels.push(...toArray(response.channels));

      const responseMetadata: unknown = (response as { response_metadata?: unknown }).response_metadata;
      nextCursor = extractNextCursor(responseMetadata);
      if (!nextCursor) {
        cursor = "";
        break;
      }
      cursor = nextCursor;
    }

    const lines: string[] = [];
    for (const channel of channels) {
      const line = formatChannelLine(channel);
      if (line) {
        lines.push(line);
      }
    }

    const headerParts = [
      "Slack channels",
      `- types: ${types}`,
      `- excludeArchived: ${args.excludeArchived}`,
      `- fetched: ${lines.length}`,
      ...(nextCursor ? [`- nextCursor: ${nextCursor}`] : []),
    ];
    const body = lines.length > 0 ? lines.join("\n") : "(no channels)";

    return {
      content: [textContent(`${headerParts.join("\n")}\n\n${body}`)],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    const hint =
      "채널 목록 조회(conversations.list)에 실패했어요. 봇 토큰 권한(conversations:read)과 봇이 접근 가능한 채널 범위를 확인해 주세요.";
    return {
      content: [textContent(`채널 목록 조회 실패: ${message}\n\n${hint}`)],
      isError: true,
    };
  }
};

const handlePostMessage = async (args: PostMessageArgs) => {
  const text = args.text?.trim() ?? "";
  const blocks = args.blocks as Array<Block | KnownBlock> | undefined;
  const hasText = text.length > 0;
  const hasBlocks = Array.isArray(blocks) && blocks.length > 0;

  if (!hasText && !hasBlocks) {
    return {
      content: [textContent("메시지 전송 실패: text 또는 blocks 중 하나는 반드시 필요합니다.")],
      isError: true,
    };
  }

  const channel = args.channelId.trim();
  const threadTsRaw = args.threadTs?.trim() ?? "";

  const response = hasBlocks
    ? await SlackSDK.instance.postMessage({
        channel,
        blocks,
        ...(hasText ? { text } : {}),
        ...(threadTsRaw.length > 0 ? { thread_ts: threadTsRaw } : {}),
      })
    : await SlackSDK.instance.postMessage({
        channel,
        text,
        ...(threadTsRaw.length > 0 ? { thread_ts: threadTsRaw } : {}),
      });

  const messageTs = toNonEmptyString(response.ts) ?? "unknown";
  const usedThreadTs = threadTsRaw.length > 0 ? threadTsRaw : "(none)";

  return {
    content: [
      textContent(
        [
          "Slack 메시지 전송 완료",
          `- channelId: ${channel}`,
          `- threadTs: ${usedThreadTs}`,
          `- messageTs: ${messageTs}`,
        ].join("\n"),
      ),
    ],
  };
};

const handleDownloadFile = async (_ctx: SlackToolsContext, args: DownloadFileArgs) => {
  const fileInfo = await SlackSDK.instance.getFileInfo({ file: args.fileId });
  const file = fileInfo.file;

  if (!file) {
    return {
      content: [textContent(`파일을 찾을 수 없습니다: ${args.fileId}`)],
    };
  }

  const downloadUrl = file.url_private_download ?? file.url_private;
  if (!downloadUrl) {
    return {
      content: [textContent(`다운로드 URL이 없습니다. 파일 타입: ${file.filetype ?? "unknown"}`)],
    };
  }

  const downloadDir = path.join(CONFIG.WORKSPACE_DIR, "slack-downloads");
  await fs.mkdir(downloadDir, { recursive: true });

  const safeName = (file.name ?? `${args.fileId}.${file.filetype ?? "bin"}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = path.join(downloadDir, `${args.fileId}_${safeName}`);

  const buffer = await SlackSDK.instance.downloadFile(downloadUrl);
  await fs.writeFile(localPath, Buffer.from(buffer));

  const sizeKB = Math.round((file.size ?? buffer.byteLength) / 1024);

  return {
    content: [
      textContent(
        [
          "파일 다운로드 완료",
          `- 이름: ${file.name ?? "unknown"}`,
          `- 타입: ${file.filetype ?? "unknown"}`,
          `- 크기: ${sizeKB} KB`,
          `- 경로: ${localPath}`,
        ].join("\n"),
      ),
    ],
  };
};

export const createSlackToolset = (_ctx: SlackToolsContext = {}) => ({
  getMessages: {
    description: GET_MESSAGES_DESCRIPTION,
    inputSchema: GetMessagesSchema.shape,
    handler: (args: GetMessagesArgs) => handleGetMessages(args),
  },
  listChannels: {
    description: LIST_CHANNELS_DESCRIPTION,
    inputSchema: ListChannelsSchema.shape,
    handler: (args: ListChannelsArgs) => handleListChannels(args),
  },
  postMessage: {
    description: POST_MESSAGE_DESCRIPTION,
    inputSchema: PostMessageSchema.shape,
    handler: (args: PostMessageArgs) => handlePostMessage(args),
  },
  downloadFile: {
    description: DOWNLOAD_FILE_DESCRIPTION,
    inputSchema: DownloadFileSchema.shape,
    handler: (args: DownloadFileArgs) => handleDownloadFile(_ctx, args),
  },
});
