import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { createSlackToolset } from "./slackTools.ts";

export type KarbySlackMcpContext = {
  slack: {
    teamId: string | null;
    channelId: string;
    threadTs: string | null;
    messageTs: string;
    slackUserId: string;
  };
  getSessionId: () => string | null;
};

export const createSenaSlackMcpServer = (_ctx: KarbySlackMcpContext) => {
  const slackTools = createSlackToolset();

  return createSdkMcpServer({
    name: "slack",
    version: "0.0.1",
    tools: [
      tool(
        "get_messages",
        slackTools.getMessages.description,
        slackTools.getMessages.inputSchema,
        slackTools.getMessages.handler,
      ),
      tool(
        "list_channels",
        slackTools.listChannels.description,
        slackTools.listChannels.inputSchema,
        slackTools.listChannels.handler,
      ),
      tool(
        "post_message",
        slackTools.postMessage.description,
        slackTools.postMessage.inputSchema,
        slackTools.postMessage.handler,
      ),
      tool(
        "download_file",
        slackTools.downloadFile.description,
        slackTools.downloadFile.inputSchema,
        slackTools.downloadFile.handler,
      ),
    ],
  });
};
