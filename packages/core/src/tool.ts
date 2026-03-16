import { z, type ZodSchema } from 'zod'
import type { InlineToolPort, ToolContent, InlineToolDef } from './types.js'

const TOOL_RESULT: unique symbol = Symbol('ToolResult')

export type BrandedToolResult = {
  [TOOL_RESULT]: true
  content: ToolContent[]
}

export type DefineToolOptions = {
  name: string
  description: string
  params?: Record<string, ZodSchema>
  handler: InlineToolDef['handler']
}

export function defineTool(options: DefineToolOptions): InlineToolPort {
  const inputSchema = options.params
    ? paramsToJsonSchema(options.params)
    : { type: 'object' as const, properties: {} }
  return {
    name: options.name,
    type: 'inline',
    inline: {
      description: options.description,
      params: options.params,
      inputSchema,
      handler: options.handler,
    },
  }
}

export function toolResult(content: ToolContent[]): BrandedToolResult {
  return { [TOOL_RESULT]: true, content }
}

export function isBrandedToolResult(value: unknown): value is BrandedToolResult {
  return typeof value === 'object' && value !== null && TOOL_RESULT in value
}

export function paramsToJsonSchema(params: Record<string, ZodSchema>): Record<string, unknown> {
  const schema = z.object(params)
  return z.toJSONSchema(schema) as Record<string, unknown>
}
