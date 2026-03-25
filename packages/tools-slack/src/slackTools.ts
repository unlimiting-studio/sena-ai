import { defineTool, toolResult } from '@sena-ai/core'
import { WebClient } from '@slack/web-api'
import { z } from 'zod'
import type { ToolPort } from '@sena-ai/core'
import { markdownToMrkdwn } from './mrkdwn.js'

/** In-memory TTL cache with sliding expiration. */
class TtlCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>()
  constructor(private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    // Sliding: extend TTL on access
    entry.expiresAt = Date.now() + this.ttlMs
    return entry.value
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.store.clear()
  }
}

const ONE_HOUR = 60 * 60 * 1000

export type SlackToolsOptions = { botToken: string }

export function slackTools(options: SlackToolsOptions): ToolPort[] {
  const slack = new WebClient(options.botToken)
  const userNameCache = new Map<string, string>()

  // Cache for conversations.list — keyed by "limit:types"
  const channelListCache = new TtlCache<string, string>(ONE_HOUR)

  async function resolveUserName(userId: string): Promise<string> {
    if (!userId) return userId
    const cached = userNameCache.get(userId)
    if (cached !== undefined) return cached
    try {
      const result = await slack.users.info({ user: userId })
      const profile = result.user?.profile as any
      const name = profile?.display_name || profile?.real_name || userId
      userNameCache.set(userId, name)
      return name
    } catch {
      userNameCache.set(userId, userId)
      return userId
    }
  }

  return [
    defineTool({
      name: 'slack_get_messages',
      description: 'Get messages from a Slack channel or thread. Returns parsed block kit content and attachments.',
      params: {
        channelId: z.string().describe('Channel ID'),
        threadTs: z.string().optional().describe('Thread timestamp (optional)'),
        limit: z.number().optional().default(20).describe('Max messages to return'),
        mode: z.enum(['thread', 'channel']).optional().default('thread').describe('thread: get thread replies, channel: get channel messages'),
        oldest: z.string().optional().describe('Only messages after this timestamp'),
        latest: z.string().optional().describe('Only messages before this timestamp'),
      },
      handler: async ({ channelId, threadTs, limit, mode, oldest, latest }: {
        channelId: string; threadTs?: string; limit?: number;
        mode?: 'thread' | 'channel'; oldest?: string; latest?: string
      }) => {
        const params: any = { channel: channelId, limit }
        if (oldest) params.oldest = oldest
        if (latest) params.latest = latest
        let result: any
        if (mode === 'thread' && threadTs) {
          params.ts = threadTs
          result = await slack.conversations.replies(params)
        } else {
          result = await slack.conversations.history(params)
        }
        const userIds: string[] = [...new Set((result.messages ?? []).map((m: any) => m.user).filter(Boolean) as string[])]
        await Promise.all(userIds.map((uid) => resolveUserName(uid)))
        const messages = (result.messages ?? []).map((m: any) => {
          const parsed = parseMessageContent(m)
          return {
            user: m.user,
            userName: m.user ? (userNameCache.get(m.user) ?? m.user) : undefined,
            text: parsed,
            ts: m.ts,
            thread_ts: m.thread_ts,
            ...(m.files?.length ? { files: m.files.map((f: any) => ({ id: f.id, name: f.name, mimetype: f.mimetype })) } : {}),
          }
        })
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
        const mrkdwnText = markdownToMrkdwn(text)
        const params: any = { channel: channelId, text: mrkdwnText }
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
        const cacheKey = `${limit}:${types}`
        const cached = channelListCache.get(cacheKey)
        if (cached) return cached

        const result = await slack.conversations.list({ limit, types })
        const channels = (result.channels ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          is_private: c.is_private,
          num_members: c.num_members,
        }))
        const json = JSON.stringify(channels, null, 2)
        channelListCache.set(cacheKey, json)
        return json
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
      name: 'slack_get_users',
      description: 'Get user profile information for one or more Slack user IDs',
      params: {
        userIds: z.array(z.string()).describe('Array of Slack user IDs to look up'),
      },
      handler: async ({ userIds }: { userIds: string[] }) => {
        const results = await Promise.all(
          userIds.map(async (uid) => {
            try {
              const result = await slack.users.info({ user: uid })
              const u = result.user as any
              return {
                id: u?.id,
                name: u?.name,
                real_name: u?.real_name,
                display_name: u?.profile?.display_name,
                email: u?.profile?.email,
                is_bot: u?.is_bot,
                timezone: u?.tz,
              }
            } catch {
              return { id: uid, error: 'not found' }
            }
          }),
        )
        return JSON.stringify(results, null, 2)
      },
    }),

    defineTool({
      name: 'slack_download_file',
      description: 'Download a file from Slack by file ID. Images are returned as visual content; text files are returned as text.',
      params: {
        fileId: z.string().describe('Slack file ID'),
      },
      handler: async ({ fileId }: { fileId: string }) => {
        const info = await slack.files.info({ file: fileId })
        const file = info.file as Record<string, unknown> | undefined
        if (!file?.url_private) {
          return JSON.stringify({ error: 'File URL not available' })
        }
        const response = await fetch(file.url_private as string, {
          headers: { Authorization: `Bearer ${options.botToken}` },
        })
        if (!response.ok) {
          return JSON.stringify({ error: `Download failed: ${response.status} ${response.statusText}` })
        }
        const mimeType = (file.mimetype as string) ?? response.headers.get('content-type') ?? 'application/octet-stream'
        const isImage = mimeType.startsWith('image/')

        if (isImage) {
          const buf = await response.arrayBuffer()
          const base64 = Buffer.from(buf).toString('base64')
          return toolResult([
            { type: 'text', text: JSON.stringify({ name: file.name, mimetype: mimeType, size: file.size }) },
            { type: 'image', data: base64, mimeType },
          ])
        }

        // Non-image files: return as text
        const text = await response.text()
        const maxLen = 50000
        return JSON.stringify({
          name: file.name,
          mimetype: mimeType,
          size: file.size,
          content: text.length > maxLen ? text.slice(0, maxLen) + '\n...(truncated)' : text,
        })
      },
    }),
  ]
}

// --- Block Kit & Attachment Parser ---

function parseMessageContent(msg: any): string {
  const parts: string[] = []

  // 1. Parse blocks (Block Kit)
  if (msg.blocks?.length) {
    parts.push(parseBlocks(msg.blocks))
  } else if (msg.text) {
    // Fallback to plain text if no blocks
    parts.push(msg.text)
  }

  // 2. Parse attachments
  if (msg.attachments?.length) {
    for (const att of msg.attachments) {
      parts.push(parseAttachment(att))
    }
  }

  return parts.filter(Boolean).join('\n\n') || msg.text || ''
}

function parseBlocks(blocks: any[]): string {
  return blocks.map(parseBlock).filter(Boolean).join('\n')
}

function parseBlock(block: any): string {
  switch (block.type) {
    case 'section': {
      const text = parseTextObject(block.text)
      const fields = block.fields?.map(parseTextObject).join(' | ') ?? ''
      return [text, fields].filter(Boolean).join('\n')
    }
    case 'header':
      return parseTextObject(block.text)
    case 'context':
      return block.elements?.map((el: any) => {
        if (el.type === 'image') return `[image: ${el.alt_text ?? ''}]`
        return parseTextObject(el)
      }).filter(Boolean).join(' · ') ?? ''
    case 'rich_text':
      return block.elements?.map(parseRichTextElement).filter(Boolean).join('\n') ?? ''
    case 'divider':
      return '---'
    case 'image':
      return `[image: ${block.alt_text ?? block.title?.text ?? ''}]`
    case 'actions':
      return block.elements?.map((el: any) => {
        if (el.text) return `[${parseTextObject(el.text)}]`
        return ''
      }).filter(Boolean).join(' ') ?? ''
    default:
      // Unknown block type — try extracting text if present
      if (block.text) return parseTextObject(block.text)
      return ''
  }
}

function parseRichTextElement(element: any): string {
  switch (element.type) {
    case 'rich_text_section':
      return element.elements?.map(parseRichTextPiece).join('') ?? ''
    case 'rich_text_list': {
      const style = element.style === 'ordered' ? 'ol' : 'ul'
      return element.elements?.map((item: any, i: number) => {
        const content = item.elements?.map(parseRichTextPiece).join('') ?? ''
        return style === 'ol' ? `${i + 1}. ${content}` : `• ${content}`
      }).join('\n') ?? ''
    }
    case 'rich_text_preformatted':
      return '```\n' + (element.elements?.map(parseRichTextPiece).join('') ?? '') + '\n```'
    case 'rich_text_quote':
      return (element.elements?.map(parseRichTextPiece).join('') ?? '').split('\n').map((l: string) => `> ${l}`).join('\n')
    default:
      return ''
  }
}

function parseRichTextPiece(piece: any): string {
  switch (piece.type) {
    case 'text':
      return piece.text ?? ''
    case 'link':
      return piece.text ? `${piece.text} (${piece.url})` : piece.url ?? ''
    case 'emoji':
      return `:${piece.name}:`
    case 'user':
      return `<@${piece.user_id}>`
    case 'channel':
      return `<#${piece.channel_id}>`
    case 'usergroup':
      return `<!subteam^${piece.usergroup_id}>`
    default:
      return piece.text ?? ''
  }
}

function parseTextObject(textObj: any): string {
  if (!textObj) return ''
  if (typeof textObj === 'string') return textObj
  return textObj.text ?? ''
}

function parseAttachment(att: any): string {
  const parts: string[] = []
  if (att.pretext) parts.push(att.pretext)
  if (att.title) parts.push(att.title_link ? `${att.title} (${att.title_link})` : att.title)
  if (att.text) parts.push(att.text)
  if (att.fields?.length) {
    for (const f of att.fields) {
      parts.push(`${f.title}: ${f.value}`)
    }
  }
  if (att.footer) parts.push(`— ${att.footer}`)
  // Nested message_blocks (unfurled links, etc.)
  if (att.message_blocks?.length) {
    for (const mb of att.message_blocks) {
      if (mb.message?.blocks) parts.push(parseBlocks(mb.message.blocks))
    }
  }
  return parts.filter(Boolean).join('\n')
}
