import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";

import type { CouchDBClient } from "../sdks/couchdb.ts";
import { createObsidianToolset } from "./obsidianTools.ts";

export const createSenaObsidianMcpServer = (client: CouchDBClient) => {
  const obsidianTools = createObsidianToolset(client);

  return createSdkMcpServer({
    name: "obsidian",
    version: "0.0.1",
    tools: [
      tool(
        "list_notes",
        obsidianTools.listNotes.description,
        obsidianTools.listNotes.inputSchema,
        obsidianTools.listNotes.handler,
      ),
      tool(
        "read_note",
        obsidianTools.readNote.description,
        obsidianTools.readNote.inputSchema,
        obsidianTools.readNote.handler,
      ),
      tool(
        "search_notes",
        obsidianTools.searchNotes.description,
        obsidianTools.searchNotes.inputSchema,
        obsidianTools.searchNotes.handler,
      ),
      tool(
        "write_note",
        obsidianTools.writeNote.description,
        obsidianTools.writeNote.inputSchema,
        obsidianTools.writeNote.handler,
      ),
    ],
  });
};
