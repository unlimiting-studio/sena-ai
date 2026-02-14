import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getCouchDBClient } from "../sdks/couchdb.ts";
import { createObsidianToolset } from "./obsidianTools.ts";
import { createSlackToolset } from "./slackTools.ts";

type CodexBridgeServerName = "slack" | "obsidian";

const createSlackBridgeServer = (): McpServer => {
  const server = new McpServer({
    name: "sena-slack-codex-bridge",
    version: "0.0.1",
  });
  const slackTools = createSlackToolset();

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
  const server = serverName === "slack" ? createSlackBridgeServer() : createObsidianBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
};
