import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineTool, toolResult, isBrandedToolResult, paramsToJsonSchema } from '../tool.js'
import type { InlineToolPort } from '../types.js'

describe('defineTool()', () => {
  it('creates InlineToolPort with correct fields', () => {
    const tool = defineTool({
      name: 'greet',
      description: 'Greets a user',
      params: { name: z.string() },
      handler: async ({ name }: { name: string }) => `Hello, ${name}!`,
    })

    expect(tool.name).toBe('greet')
    expect(tool.type).toBe('inline')
    expect(tool.inline.description).toBe('Greets a user')
    expect(tool.inline.params).toBeDefined()
    expect(tool.inline.inputSchema).toBeDefined()

    // Type check: should be InlineToolPort
    const _typed: InlineToolPort = tool
    expect(_typed.type).toBe('inline')
  })

  it('handles optional params in Zod schema (required vs optional)', () => {
    const tool = defineTool({
      name: 'search',
      description: 'Search tool',
      params: {
        query: z.string(),
        limit: z.number().optional(),
      },
      handler: async ({ query }: { query: string }) => `Results for ${query}`,
    })

    const schema = tool.inline.inputSchema as any
    expect(schema.type).toBe('object')
    expect(schema.properties).toBeDefined()
    expect(schema.properties.query).toBeDefined()
    expect(schema.properties.limit).toBeDefined()
    // required should only include non-optional fields
    expect(schema.required).toContain('query')
    expect(schema.required).not.toContain('limit')
  })

  it('creates parameterless tool (no params)', () => {
    const tool = defineTool({
      name: 'ping',
      description: 'Ping the server',
      handler: async () => 'pong',
    })

    expect(tool.name).toBe('ping')
    expect(tool.type).toBe('inline')
    expect(tool.inline.params).toBeUndefined()
    const schema = tool.inline.inputSchema as any
    expect(schema.type).toBe('object')
    expect(schema.properties).toEqual({})
  })

  it('handler is callable and returns expected value', async () => {
    const tool = defineTool({
      name: 'add',
      description: 'Adds two numbers',
      params: {
        a: z.number(),
        b: z.number(),
      },
      handler: async ({ a, b }: { a: number; b: number }) => ({ result: a + b }),
    })

    const result = await tool.inline.handler({ a: 3, b: 4 })
    expect(result).toEqual({ result: 7 })
  })
})

describe('toolResult()', () => {
  it('creates branded result and isBrandedToolResult detects it', () => {
    const result = toolResult([{ type: 'text', text: 'hello' }])
    expect(isBrandedToolResult(result)).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('plain objects are not branded', () => {
    expect(isBrandedToolResult({})).toBe(false)
    expect(isBrandedToolResult({ content: [] })).toBe(false)
    expect(isBrandedToolResult(null)).toBe(false)
    expect(isBrandedToolResult('string')).toBe(false)
  })
})

describe('paramsToJsonSchema()', () => {
  it('converts zod schema to JSON schema', () => {
    const schema = paramsToJsonSchema({ name: z.string(), age: z.number() })
    expect((schema as any).type).toBe('object')
    expect((schema as any).properties.name).toBeDefined()
    expect((schema as any).properties.age).toBeDefined()
  })
})
