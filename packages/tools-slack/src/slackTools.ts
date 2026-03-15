import type { ToolPort, RuntimeInfo, McpConfig } from '@sena-ai/core'

export type SlackToolsOptions = {
  botToken: string
}

/**
 * Creates a ToolPort for Slack MCP tools.
 * Exposes: get_messages, post_message, list_channels, upload_file, download_file
 */
export function slackTools(options: SlackToolsOptions): ToolPort {
  const { botToken } = options

  return {
    name: 'slack',
    type: 'mcp-stdio',
    toMcpConfig(_runtime: RuntimeInfo): McpConfig {
      // The MCP server is shipped as part of this package
      // It wraps @slack/web-api operations as MCP tool calls
      return {
        command: 'node',
        args: [new URL('../dist/mcp-server.js', import.meta.url).pathname],
        env: {
          SLACK_BOT_TOKEN: botToken,
        },
      }
    },
  }
}
