import { WebClient } from '@slack/web-api'
import { createInterface } from 'node:readline'

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN
if (!SLACK_BOT_TOKEN) {
  console.error('SLACK_BOT_TOKEN is required')
  process.exit(1)
}

const slack = new WebClient(SLACK_BOT_TOKEN)

// === Tool definitions ===

const tools = [
  {
    name: 'slack_get_messages',
    description: 'Get messages from a Slack channel or thread',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel ID' },
        threadTs: { type: 'string', description: 'Thread timestamp (optional)' },
        limit: { type: 'number', description: 'Max messages to return (default 20)' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'slack_post_message',
    description: 'Post a message to a Slack channel or thread',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel ID' },
        text: { type: 'string', description: 'Message text' },
        threadTs: { type: 'string', description: 'Thread timestamp (optional, for replying in thread)' },
      },
      required: ['channelId', 'text'],
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List accessible Slack channels',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max channels to return (default 100)' },
        types: { type: 'string', description: 'Channel types (default "public_channel,private_channel")' },
      },
    },
  },
  {
    name: 'slack_upload_file',
    description: 'Upload content as a file to a Slack channel',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Channel ID' },
        content: { type: 'string', description: 'File content' },
        filename: { type: 'string', description: 'Filename' },
        title: { type: 'string', description: 'File title (optional)' },
      },
      required: ['channelId', 'content', 'filename'],
    },
  },
  {
    name: 'slack_download_file',
    description: 'Download a file from Slack by file ID',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Slack file ID' },
      },
      required: ['fileId'],
    },
  },
]

// === Tool implementations ===

async function executeTool(name: string, args: any): Promise<string> {
  switch (name) {
    case 'slack_get_messages': {
      const { channelId, threadTs, limit = 20 } = args
      const params: any = { channel: channelId, limit }
      let result: any
      if (threadTs) {
        params.ts = threadTs
        result = await slack.conversations.replies(params)
      } else {
        result = await slack.conversations.history(params)
      }
      const messages = (result.messages ?? []).map((m: any) => ({
        user: m.user,
        text: m.text,
        ts: m.ts,
        thread_ts: m.thread_ts,
      }))
      return JSON.stringify(messages, null, 2)
    }

    case 'slack_post_message': {
      const { channelId, text, threadTs } = args
      const params: any = { channel: channelId, text }
      if (threadTs) params.thread_ts = threadTs
      const result = await slack.chat.postMessage(params)
      return JSON.stringify({ ok: result.ok, ts: result.ts })
    }

    case 'slack_list_channels': {
      const { limit = 100, types = 'public_channel,private_channel' } = args
      const result = await slack.conversations.list({ limit, types })
      const channels = (result.channels ?? []).map((c: any) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private,
        num_members: c.num_members,
      }))
      return JSON.stringify(channels, null, 2)
    }

    case 'slack_upload_file': {
      const { channelId, content, filename, title } = args
      const result = await slack.filesUploadV2({
        channel_id: channelId,
        content,
        filename,
        title: title ?? filename,
      })
      return JSON.stringify({ ok: true, file_id: (result as any).file?.id })
    }

    case 'slack_download_file': {
      const { fileId } = args
      const info = await slack.files.info({ file: fileId })
      const file = info.file as any
      if (!file?.url_private) {
        return JSON.stringify({ error: 'File URL not available' })
      }
      // Fetch the file content using the bot token
      const response = await fetch(file.url_private, {
        headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
      })
      const text = await response.text()
      return JSON.stringify({
        name: file.name,
        mimetype: file.mimetype,
        size: file.size,
        content: text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text,
      })
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// === JSON-RPC server ===

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

function handleRequest(id: number | string, method: string, params: any): void {
  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sena-slack-mcp', version: '0.0.1' },
        },
      })
      break

    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: { tools },
      })
      break

    case 'tools/call':
      executeTool(params.name, params.arguments ?? {})
        .then((text) => {
          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text }] },
          })
        })
        .catch((err) => {
          send({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true,
            },
          })
        })
      break

    default:
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      })
  }
}

// Main loop
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    const msg = JSON.parse(line)
    if (msg.method && msg.id !== undefined) {
      handleRequest(msg.id, msg.method, msg.params)
    }
    // Notifications (no id) — just ignore
  } catch {
    // Ignore malformed lines
  }
})
