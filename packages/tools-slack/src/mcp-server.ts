/**
 * Slack MCP Server
 *
 * This file runs as a standalone process, exposing Slack API operations
 * as MCP tools via stdio JSON-RPC.
 *
 * Tools exposed:
 * - slack_get_messages: Get messages from a channel/thread
 * - slack_post_message: Post a message to a channel/thread
 * - slack_list_channels: List accessible channels
 * - slack_upload_file: Upload a file
 * - slack_download_file: Download a file by ID
 *
 * TODO: Implement full MCP server protocol
 */

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN

if (!SLACK_BOT_TOKEN) {
  console.error('SLACK_BOT_TOKEN is required')
  process.exit(1)
}

// Placeholder — full MCP server implementation comes later
console.error('Slack MCP Server started (stub)')
