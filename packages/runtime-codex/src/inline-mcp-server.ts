import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isBrandedToolResult } from '@sena-ai/core'
import type { InlineToolPort, BrandedToolResult, ToolContent } from '@sena-ai/core'

export type InlineMcpBridge = {
  url: string
  close: () => Promise<void>
}

export async function startInlineMcpHttpServer(
  inlineTools: InlineToolPort[],
): Promise<InlineMcpBridge | null> {
  if (inlineTools.length === 0) return null

  // Map of sessionId → transport for stateful sessions
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }

    if (req.method === 'POST') {
      const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? undefined

      let transport: StreamableHTTPServerTransport

      if (sessionId && transports.has(sessionId)) {
        // Existing session — reuse its transport
        transport = transports.get(sessionId)!
      } else {
        // New session — create transport + McpServer pair
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport)
          },
        })

        const mcpServer = new McpServer({ name: 'sena-inline-tools', version: '1.0.0' })

        for (const tool of inlineTools) {
          // Use the tool's Zod params if available (from defineTool), otherwise
          // use a loose object schema so arbitrary arguments are forwarded unchanged.
          // z.looseObject({}) is Zod v4's equivalent of z.object({}).passthrough()
          const inputSchema: Record<string, z.ZodTypeAny> | z.ZodTypeAny =
            tool.inline.params && Object.keys(tool.inline.params).length > 0
              ? tool.inline.params
              : z.looseObject({})
          mcpServer.registerTool(
            tool.name,
            { description: tool.inline.description, inputSchema },
            async (params: Record<string, unknown>) => {
              try {
                const raw = await tool.inline.handler(params)
                return normalizeToMcpResult(raw)
              } catch (err: any) {
                return { isError: true, content: [{ type: 'text' as const, text: err.message ?? String(err) }] }
              }
            },
          )
        }

        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid) transports.delete(sid)
        }

        await mcpServer.connect(transport)
      }

      await transport.handleRequest(req, res)
    } else if (req.method === 'GET' || req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId)!.handleRequest(req, res)
      } else {
        res.writeHead(404).end()
      }
    } else {
      res.writeHead(405).end()
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
    httpServer.once('error', reject)
  })

  const address = httpServer.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/mcp`

  return {
    url,
    close: async () => {
      // Close all active transports
      for (const transport of transports.values()) {
        await transport.close()
      }
      transports.clear()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}

function normalizeToMcpResult(raw: unknown): { content: { type: 'text'; text: string }[] } {
  if (isBrandedToolResult(raw)) {
    const textContent = (raw.content as ToolContent[])
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    if (textContent.length > 0) return { content: textContent }
    return { content: [{ type: 'text', text: JSON.stringify(raw.content) }] }
  }
  if (typeof raw === 'string') return { content: [{ type: 'text', text: raw }] }
  return { content: [{ type: 'text', text: JSON.stringify(raw) }] }
}
