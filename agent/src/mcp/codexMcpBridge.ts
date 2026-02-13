import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getCouchDBClient } from "../sdks/couchdb.ts";
import { createObsidianToolset } from "./obsidianTools.ts";
import { createSlackToolset } from "./slackTools.ts";

type CodexBridgeServerName = "slack" | "obsidian";

type SlackBridgeContext = {
  teamId: string | null;
  channelId: string | null;
  threadTs: string | null;
  messageTs: string | null;
  slackUserId: string | null;
};

const toOptionalNonEmptyString = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const loadSlackContextFromEnv = (): SlackBridgeContext => ({
  teamId: toOptionalNonEmptyString(process.env.SENA_MCP_SLACK_TEAM_ID),
  channelId: toOptionalNonEmptyString(process.env.SENA_MCP_SLACK_CHANNEL_ID),
  threadTs: toOptionalNonEmptyString(process.env.SENA_MCP_SLACK_THREAD_TS),
  messageTs: toOptionalNonEmptyString(process.env.SENA_MCP_SLACK_MESSAGE_TS),
  slackUserId: toOptionalNonEmptyString(process.env.SENA_MCP_SLACK_USER_ID),
});

const createSlackBridgeServer = (ctx: SlackBridgeContext): McpServer => {
  const server = new McpServer({
    name: "sena-slack-codex-bridge",
    version: "0.0.1",
  });
  const slackTools = createSlackToolset({
    channelId: ctx.channelId,
    threadTs: ctx.threadTs,
    messageTs: ctx.messageTs,
  });

  server.registerTool(
    "get_messages",
    {
      description: slackTools.getMessages.description,
      inputSchema: slackTools.getMessages.inputSchema,
    },
    slackTools.getMessages.handler,
  );

  server.registerTool(
    "post_message",
    {
      description: slackTools.postMessage.description,
      inputSchema: slackTools.postMessage.inputSchema,
    },
    slackTools.postMessage.handler,
  );

  server.registerTool(
    "download_file",
    {
      description: slackTools.downloadFile.description,
      inputSchema: slackTools.downloadFile.inputSchema,
    },
    slackTools.downloadFile.handler,
  );

  return server;
};

const createObsidianBridgeServer = (): McpServer => {
  const client = getCouchDBClient();
  if (!client) {
    throw new Error("Obsidian bridge MCP requires CouchDB configuration.");
  }

  const server = new McpServer({
    name: "sena-obsidian-codex-bridge",
    version: "0.0.1",
  });
  const obsidianTools = createObsidianToolset(client);

  server.registerTool(
    "list_notes",
    {
      description: obsidianTools.listNotes.description,
      inputSchema: obsidianTools.listNotes.inputSchema,
    },
    obsidianTools.listNotes.handler,
  );

  server.registerTool(
    "read_note",
    {
      description: obsidianTools.readNote.description,
      inputSchema: obsidianTools.readNote.inputSchema,
    },
    obsidianTools.readNote.handler,
  );

  server.registerTool(
    "search_notes",
    {
      description: obsidianTools.searchNotes.description,
      inputSchema: obsidianTools.searchNotes.inputSchema,
    },
    obsidianTools.searchNotes.handler,
  );

  server.registerTool(
    "write_note",
    {
      description: obsidianTools.writeNote.description,
      inputSchema: obsidianTools.writeNote.inputSchema,
    },
    obsidianTools.writeNote.handler,
  );

  return server;
};

export const runCodexMcpBridgeServer = async (serverName: CodexBridgeServerName): Promise<void> => {
  const server = serverName === "slack" ? createSlackBridgeServer(loadSlackContextFromEnv()) : createObsidianBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
