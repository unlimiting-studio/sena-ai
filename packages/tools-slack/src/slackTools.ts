import { defineTool } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { z } from 'zod'
import type { ToolPort } from '@sena-ai/core'

export type SlackToolsOptions = { botToken: string }

export function slackTools(options: SlackToolsOptions): ToolPort[] {
  const slack = new WebClient(options.botToken)

  return [
    defineTool({
      name: 'slack_get_messages',
      description: 'Get messages from a Slack channel or thread',
      params: {
        channelId: z.string().describe('Channel ID'),
        threadTs: z.string().optional().describe('Thread timestamp (optional)'),
        limit: z.number().optional().default(20).describe('Max messages to return'),
      },
      handler: async ({ channelId, threadTs, limit }: { channelId: string; threadTs?: string; limit?: number }) => {
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
      },
    }),

    defineTool({
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel or thread',
      params: {
        channelId: z.string().describe('Channel ID'),
        text: z.string().describe('Message text'),
        threadTs: z.string().optional().describe('Thread timestamp (optional, for replying in thread)'),
      },
      handler: async ({ channelId, text, threadTs }: { channelId: string; text: string; threadTs?: string }) => {
        const params: any = { channel: channelId, text }
        if (threadTs) params.thread_ts = threadTs
        const result = await slack.chat.postMessage(params)
        return JSON.stringify({ ok: result.ok, ts: result.ts })
      },
    }),

    defineTool({
      name: 'slack_list_channels',
      description: 'List accessible Slack channels',
      params: {
        limit: z.number().optional().default(100).describe('Max channels to return'),
        types: z.string().optional().default('public_channel,private_channel').describe('Channel types'),
      },
      handler: async ({ limit, types }: { limit?: number; types?: string }) => {
        const result = await slack.conversations.list({ limit, types })
        const channels = (result.channels ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          is_private: c.is_private,
          num_members: c.num_members,
        }))
        return JSON.stringify(channels, null, 2)
      },
    }),

    defineTool({
      name: 'slack_upload_file',
      description: 'Upload content as a file to a Slack channel',
      params: {
        channelId: z.string().describe('Channel ID'),
        content: z.string().describe('File content'),
        filename: z.string().describe('Filename'),
        title: z.string().optional().describe('File title'),
      },
      handler: async ({ channelId, content, filename, title }: { channelId: string; content: string; filename: string; title?: string }) => {
        const result = await slack.filesUploadV2({
          channel_id: channelId,
          content,
          filename,
          title: title ?? filename,
        })
        return JSON.stringify({ ok: true, file_id: (result as any).file?.id })
      },
    }),

    defineTool({
      name: 'slack_download_file',
      description: 'Download a file from Slack by file ID',
      params: {
        fileId: z.string().describe('Slack file ID'),
      },
      handler: async ({ fileId }: { fileId: string }) => {
        const info = await slack.files.info({ file: fileId })
        const file = info.file as any
        if (!file?.url_private) {
          return JSON.stringify({ error: 'File URL not available' })
        }
        const response = await fetch(file.url_private, {
          headers: { Authorization: `Bearer ${options.botToken}` },
        })
        const text = await response.text()
        return JSON.stringify({
          name: file.name,
          mimetype: file.mimetype,
          size: file.size,
          content: text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text,
        })
      },
    }),
  ]
}
