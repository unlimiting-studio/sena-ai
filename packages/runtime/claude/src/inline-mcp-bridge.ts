import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { isBrandedToolResult } from '@sena-ai/core'
import type { InlineToolPort, ToolContent } from '@sena-ai/core'

export type InlineMcpBridge = {
  /** Full URL like http://127.0.0.1:12345/mcp */
  url: string
  /** Returns MCP server config for Claude SDK */
  getConfig: () => { type: 'http'; url: string }
  /** Reset all transports (kills active sessions) so the next query gets a fresh MCP connection */
  reset: () => Promise<void>
  /** Returns true if any transport closed unexpectedly since last check, then clears the flag */
  consumeDirtySignal: () => boolean
  /** Shut down the HTTP server and all transports */
  close: () => Promise<void>
}

/**
 * Start a localhost HTTP MCP server that hosts inline tools.
 * Returns null if there are no inline tools.
 *
 * This replaces the Anthropic SDK's `createSdkMcpServer()` black box so we can
 * directly observe transport lifecycle (onclose) and reset on disconnect.
 */
export async function startInlineMcpHttpBridge(
  inlineTools: InlineToolPort[],
): Promise<InlineMcpBridge | null> {
  if (inlineTools.length === 0) return null

  const transports = new Map<string, StreamableHTTPServerTransport>()
  let dirty = false
  let suppressCloseSignal = false

  function createMcpServerWithTools(): McpServer {
    const server = new McpServer({ name: 'sena-inline-tools', version: '1.0.0' })

    for (const tool of inlineTools) {
      // registerTool expects a Zod raw shape (Record<string, ZodType>), NOT a ZodType.
      // tool.inline.params is already Record<string, ZodSchema> — exactly what registerTool wants.
      // When params is undefined, pass an empty shape {}.
      const inputSchema = tool.inline.params ?? {}

      server.registerTool(
        tool.name,
        { description: tool.inline.description, inputSchema },
        async (params: Record<string, unknown>) => {
          try {
            const raw = await tool.inline.handler(params)
            return normalizeToMcpResult(raw)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return { isError: true as const, content: [{ type: 'text' as const, text: message }] }
          }
        },
      )
    }

    return server
  }

  /**
   * Read the full request body from an IncomingMessage and parse as JSON.
   */
  function readJsonBody(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve(text ? JSON.parse(text) : undefined)
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }

    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const headerValue = req.headers['mcp-session-id']
        const sessionId = typeof headerValue === 'string' ? headerValue : undefined

        if (sessionId && transports.has(sessionId)) {
          // Existing session — forward to its transport
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res, body)
          return
        }

        // New session — only allow if this is an initialize request
        if (!sessionId && isInitializeRequest(body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (newSessionId) => {
              transports.set(newSessionId, transport)
            },
          })

          transport.onclose = () => {
            const sid = transport.sessionId
            if (sid) transports.delete(sid)
            if (!suppressCloseSignal) {
              dirty = true
            }
          }

          const mcpServer = createMcpServerWithTools()
          await mcpServer.connect(transport)
          await transport.handleRequest(req, res, body)
          return
        }

        // Bad request — no session and not an initialize request
        res.writeHead(400)
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: missing session or not an initialize request' },
          id: null,
        }))
        return
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        const headerValue = req.headers['mcp-session-id']
        const sessionId = typeof headerValue === 'string' ? headerValue : undefined

        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!
          await transport.handleRequest(req, res)
          return
        }

        res.writeHead(404).end()
        return
      }

      res.writeHead(405).end()
    } catch (err) {
      console.error('[inline-mcp-bridge] request handler error:', err)
      if (!res.headersSent) {
        res.writeHead(500).end()
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
    httpServer.once('error', reject)
  })

  const address = httpServer.address() as AddressInfo
  const url = `http://127.0.0.1:${address.port}/mcp`

  async function closeAllTransports(): Promise<void> {
    suppressCloseSignal = true
    try {
      const closing = [...transports.values()].map(t => t.close().catch(() => {}))
      await Promise.all(closing)
      transports.clear()
    } finally {
      suppressCloseSignal = false
    }
  }

  return {
    url,
    getConfig: () => ({ type: 'http' as const, url }),

    async reset() {
      dirty = false
      await closeAllTransports()
    },

    consumeDirtySignal() {
      const was = dirty
      dirty = false
      return was
    },

    async close() {
      dirty = false
      await closeAllTransports()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

function normalizeToMcpResult(raw: unknown) {
  if (isBrandedToolResult(raw)) {
    return { content: raw.content.map(toMcpContent) }
  }
  if (typeof raw === 'string') {
    return { content: [{ type: 'text' as const, text: raw }] }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(raw) }] }
}

function toMcpContent(c: ToolContent) {
  if (c.type === 'text') return { type: 'text' as const, text: c.text }
  return { type: 'image' as const, data: c.data, mimeType: c.mimeType }
}
