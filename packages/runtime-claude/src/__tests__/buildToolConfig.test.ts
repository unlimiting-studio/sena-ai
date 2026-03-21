import { describe, it, expect, vi } from 'vitest'
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { buildToolConfig, formatDebugOptionsForLog } from '../runtime.js'
import { defineTool } from '@sena-ai/core'
import type { McpToolPort, RuntimeInfo } from '@sena-ai/core'
import { z } from 'zod'

function makeMcpTool(name: string): McpToolPort {
  return {
    name,
    type: 'mcp-stdio',
    toMcpConfig: (_runtime: RuntimeInfo) => ({ command: 'node', args: [name] }),
  }
}

const runtimeInfo: RuntimeInfo = { name: 'claude' }

describe('buildToolConfig', () => {
  it('handles empty tools array', () => {
    const result = buildToolConfig([], runtimeInfo)
    expect(result.mcpServers).toEqual({})
    expect(result.nativeTools).toEqual([])
    expect(result.allowedTools).toEqual([])
  })

  it('separates inline and MCP tools correctly', () => {
    const inlineTool = defineTool({
      name: 'myInlineTool',
      description: 'An inline tool',
      handler: async () => 'result',
    })
    const mcpTool = makeMcpTool('myMcpTool')

    const result = buildToolConfig([inlineTool, mcpTool], runtimeInfo)

    expect(result.nativeTools).toHaveLength(1)
    expect(result.nativeTools[0].name).toBe('myInlineTool')
    expect(result.nativeTools[0].description).toBe('An inline tool')

    expect(result.mcpServers).toHaveProperty('myMcpTool')
    expect(result.mcpServers['myMcpTool']).toEqual({ command: 'node', args: ['myMcpTool'] })
  })

  it('allowedTools uses bare name for inline, mcp__{name}__* for MCP', () => {
    const inlineTool = defineTool({
      name: 'inlineFoo',
      description: 'desc',
      handler: async () => 'ok',
    })
    const mcpTool = makeMcpTool('mcpBar')

    const result = buildToolConfig([inlineTool, mcpTool], runtimeInfo)

    expect(result.allowedTools).toContain('inlineFoo')
    expect(result.allowedTools).toContain('mcp__mcpBar__*')
    expect(result.allowedTools).not.toContain('mcp__inlineFoo__*')
    expect(result.allowedTools).not.toContain('mcpBar')
  })

  it('inline tool handler returning string is wrapped as text content', async () => {
    const inlineTool = defineTool({
      name: 'stringTool',
      description: 'returns string',
      handler: async () => 'hello world',
    })

    const result = buildToolConfig([inlineTool], runtimeInfo)
    const handler = result.nativeTools[0].handler

    const output = await handler({})
    expect(output).toEqual({ content: [{ type: 'text', text: 'hello world' }] })
  })

  it('inline tool handler returning object is JSON stringified', async () => {
    const inlineTool = defineTool({
      name: 'objectTool',
      description: 'returns object',
      handler: async () => ({ foo: 'bar', count: 42 }),
    })

    const result = buildToolConfig([inlineTool], runtimeInfo)
    const handler = result.nativeTools[0].handler

    const output = await handler({})
    expect(output).toEqual({ content: [{ type: 'text', text: JSON.stringify({ foo: 'bar', count: 42 }) }] })
  })

  it('inline tool handler that throws returns isError result', async () => {
    const inlineTool = defineTool({
      name: 'errorTool',
      description: 'throws',
      handler: async () => { throw new Error('something went wrong') },
    })

    const result = buildToolConfig([inlineTool], runtimeInfo)
    const handler = result.nativeTools[0].handler

    const output = await handler({})
    expect(output).toEqual({ isError: true, content: [{ type: 'text', text: 'something went wrong' }] })
  })

  it('formats debug options without throwing for SDK native MCP servers', () => {
    const nativeServer = createSdkMcpServer({
      name: '__native__',
      tools: [{
        name: 'hello',
        description: 'hello tool',
        inputSchema: z.object({}),
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      }],
    })

    expect(() => formatDebugOptionsForLog({
      model: 'claude-opus-4-6',
      mcpServers: { __native__: nativeServer },
    }, 'system prompt')).not.toThrow()

    const debugOutput = formatDebugOptionsForLog({
      model: 'claude-opus-4-6',
      mcpServers: { __native__: nativeServer },
    }, 'system prompt')

    expect(debugOutput).toContain('"__native__"')
    expect(debugOutput).toContain('"type": "sdk"')
  })
})
