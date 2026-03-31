import { describe, it, expect } from 'vitest'
import { buildCodexConfigOverrides } from '../runtime.js'
import type { McpToolPort } from '@sena-ai/core'

function makeHttpTool(name: string, url: string): McpToolPort {
  return {
    name,
    type: 'mcp-http',
    toMcpConfig: () => ({ url }),
  }
}

function makeStdioTool(name: string, command: string, args?: string[]): McpToolPort {
  return {
    name,
    type: 'mcp-stdio',
    toMcpConfig: () => ({ command, args }),
  }
}

describe('buildCodexConfigOverrides', () => {
  it('returns empty array when no bridge URL and no MCP tools', () => {
    expect(buildCodexConfigOverrides(null, [])).toEqual([])
  })

  it('includes inline bridge URL override when provided', () => {
    const overrides = buildCodexConfigOverrides('http://127.0.0.1:12345/mcp', [])
    expect(overrides).toEqual([
      'mcp_servers.__inline__.url="http://127.0.0.1:12345/mcp"',
    ])
  })

  it('does not include inline bridge override when URL is null', () => {
    const overrides = buildCodexConfigOverrides(null, [makeHttpTool('my-tool', 'http://example.com/mcp')])
    expect(overrides).not.toContain(expect.stringContaining('__inline__'))
  })

  it('includes HTTP MCP tool URL override', () => {
    const overrides = buildCodexConfigOverrides(null, [
      makeHttpTool('my-http-tool', 'http://example.com/mcp'),
    ])
    expect(overrides).toEqual([
      'mcp_servers.my-http-tool.url="http://example.com/mcp"',
    ])
  })

  it('includes stdio MCP tool command override', () => {
    const overrides = buildCodexConfigOverrides(null, [
      makeStdioTool('my-stdio-tool', 'npx', ['some-mcp-server']),
    ])
    expect(overrides).toEqual([
      'mcp_servers.my-stdio-tool.command="npx"',
      'mcp_servers.my-stdio-tool.args=["some-mcp-server"]',
    ])
  })

  it('handles stdio tool with no args', () => {
    const overrides = buildCodexConfigOverrides(null, [
      makeStdioTool('bare-tool', 'my-server'),
    ])
    expect(overrides).toEqual([
      'mcp_servers.bare-tool.command="my-server"',
    ])
  })

  it('splits array command into command and args overrides', () => {
    const tool: McpToolPort = {
      name: 'array-tool',
      type: 'mcp-stdio',
      toMcpConfig: () => ({ command: ['node', 'server.js', '--flag'] }),
    }
    const overrides = buildCodexConfigOverrides(null, [tool])
    expect(overrides).toEqual([
      'mcp_servers.array-tool.command="node"',
      'mcp_servers.array-tool.args=["server.js","--flag"]',
    ])
  })

  it('combines bridge URL with multiple MCP tools', () => {
    const overrides = buildCodexConfigOverrides('http://127.0.0.1:9000/mcp', [
      makeHttpTool('tool-a', 'http://a.example.com/mcp'),
      makeStdioTool('tool-b', 'run-b', ['--flag']),
    ])
    expect(overrides).toEqual([
      'mcp_servers.__inline__.url="http://127.0.0.1:9000/mcp"',
      'mcp_servers.tool-a.url="http://a.example.com/mcp"',
      'mcp_servers.tool-b.command="run-b"',
      'mcp_servers.tool-b.args=["--flag"]',
    ])
  })

  it('skips MCP tool with no url or command in config', () => {
    const tool: McpToolPort = {
      name: 'weird-tool',
      type: 'mcp-http',
      toMcpConfig: () => ({ someOtherField: 'value' }),
    }
    const overrides = buildCodexConfigOverrides(null, [tool])
    expect(overrides).toEqual([])
  })
})
