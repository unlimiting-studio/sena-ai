import { describe, it, expect } from 'vitest'
import { mcpServer } from '../mcpServer.js'

describe('mcpServer', () => {
  it('creates HTTP MCP tool port', () => {
    const tool = mcpServer({
      name: 'posthog',
      url: 'https://mcp.posthog.com/mcp',
      headers: { Authorization: 'Bearer test' },
    })

    expect(tool.name).toBe('posthog')
    expect(tool.type).toBe('mcp-http')

    const config = tool.toMcpConfig({ name: 'claude' })
    expect(config).toEqual({
      type: 'http',
      url: 'https://mcp.posthog.com/mcp',
      headers: { Authorization: 'Bearer test' },
    })
  })

  it('creates stdio MCP tool port', () => {
    const tool = mcpServer({
      name: 'my-tool',
      command: 'node',
      args: ['./server.js'],
    })

    expect(tool.name).toBe('my-tool')
    expect(tool.type).toBe('mcp-stdio')

    const config = tool.toMcpConfig({ name: 'codex' })
    expect(config).toEqual({
      command: 'node',
      args: ['./server.js'],
    })
  })

  it('omits headers when not provided for HTTP', () => {
    const tool = mcpServer({ name: 'simple', url: 'https://example.com/mcp' })
    const config = tool.toMcpConfig({ name: 'claude' })
    expect(config).toEqual({ type: 'http', url: 'https://example.com/mcp' })
    expect(config).not.toHaveProperty('headers')
  })
})
