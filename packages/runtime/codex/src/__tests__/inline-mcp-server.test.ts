import { describe, it, expect, afterEach } from 'vitest'
import { startInlineMcpHttpServer, type InlineMcpBridge } from '../inline-mcp-server.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { InlineToolPort } from '@sena-ai/core'
import { toolResult } from '@sena-ai/core'

const bridges: InlineMcpBridge[] = []

afterEach(async () => {
  for (const bridge of bridges.splice(0)) {
    await bridge.close()
  }
})

function makeTool(name: string, handler: (p: Record<string, unknown>) => unknown): InlineToolPort {
  return {
    name,
    type: 'inline',
    inline: {
      description: `Test tool: ${name}`,
      inputSchema: { type: 'object', properties: {} },
      handler: handler as (p: unknown) => string,
    },
  }
}

describe('startInlineMcpHttpServer', () => {
  it('returns null for empty tools array', async () => {
    const result = await startInlineMcpHttpServer([])
    expect(result).toBeNull()
  })

  it('starts HTTP server on random port (URL matches pattern)', async () => {
    const tool = makeTool('echo', () => 'hello')
    const bridge = await startInlineMcpHttpServer([tool])
    bridges.push(bridge!)

    expect(bridge).not.toBeNull()
    expect(bridge!.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  })

  it('responds to MCP tool call via HTTP', async () => {
    const tool = makeTool('greet', (p: Record<string, unknown>) => `Hello, ${p['name'] ?? 'world'}!`)
    const bridge = await startInlineMcpHttpServer([tool])
    bridges.push(bridge!)

    const client = new Client({ name: 'test-client', version: '0.0.1' })
    const transport = new StreamableHTTPClientTransport(new URL(bridge!.url))
    await client.connect(transport)

    try {
      const result = await client.callTool({ name: 'greet', arguments: { name: 'Sena' } })
      expect(result.content).toEqual([{ type: 'text', text: 'Hello, Sena!' }])
    } finally {
      await client.close()
    }
  })

  it('returns BrandedToolResult content correctly', async () => {
    const tool = makeTool('branded', () =>
      toolResult([{ type: 'text', text: 'branded result' }])
    )
    const bridge = await startInlineMcpHttpServer([tool])
    bridges.push(bridge!)

    const client = new Client({ name: 'test-client', version: '0.0.1' })
    const transport = new StreamableHTTPClientTransport(new URL(bridge!.url))
    await client.connect(transport)

    try {
      const result = await client.callTool({ name: 'branded', arguments: {} })
      expect(result.content).toEqual([{ type: 'text', text: 'branded result' }])
    } finally {
      await client.close()
    }
  })

  it('returns JSON-stringified result for object handlers', async () => {
    const tool = makeTool('jsonify', () => ({ status: 'ok', count: 42 }))
    const bridge = await startInlineMcpHttpServer([tool])
    bridges.push(bridge!)

    const client = new Client({ name: 'test-client', version: '0.0.1' })
    const transport = new StreamableHTTPClientTransport(new URL(bridge!.url))
    await client.connect(transport)

    try {
      const result = await client.callTool({ name: 'jsonify', arguments: {} })
      expect(result.content).toEqual([{ type: 'text', text: '{"status":"ok","count":42}' }])
    } finally {
      await client.close()
    }
  })

  it('closes HTTP server cleanly', async () => {
    const tool = makeTool('dummy', () => 'ok')
    const bridge = await startInlineMcpHttpServer([tool])!

    // Should resolve without error
    await expect(bridge!.close()).resolves.toBeUndefined()

    // Second close should also not throw (idempotent)
    // (we don't call it again since the server is already closed)
  })
})
