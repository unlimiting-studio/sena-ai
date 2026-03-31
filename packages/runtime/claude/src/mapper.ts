import type { RuntimeEvent } from '@sena-ai/core'

export type ToolResultMeta = {
  toolName: string
  isError: boolean
  errorText?: string
}

export type SdkMessageMapResult = {
  events: RuntimeEvent[]
  toolResults: ToolResultMeta[]
}

/**
 * Claude Agent SDK의 SDKMessage를 Sena RuntimeEvent 배열로 변환한다.
 *
 * Stateful: tool_use id → name 매핑을 유지하여 tool_result에서 toolName을 복원한다.
 */
export class SdkMessageMapper {
  /** tool_use block id → tool name */
  private toolUseIdToName = new Map<string, string>()

  /** Backward-compatible: returns only events */
  map(msg: any): RuntimeEvent[] {
    return this.mapWithMeta(msg).events
  }

  /** Returns events + tool result metadata (for reconnect detection) */
  mapWithMeta(msg: any): SdkMessageMapResult {
    const events: RuntimeEvent[] = []
    const toolResults: ToolResultMeta[] = []

    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init' && msg.session_id) {
          events.push({ type: 'session.init', sessionId: msg.session_id })
          if (msg.mcp_servers) {
            console.log(`[runtime-claude] MCP servers:`, JSON.stringify(msg.mcp_servers))
          }
          if (msg.tools) {
            const mcpTools = (msg.tools as string[]).filter((t: string) => t.startsWith('mcp__'))
            console.log(`[runtime-claude] MCP tools available: ${mcpTools.length > 0 ? mcpTools.join(', ') : 'NONE'}`)
          }
        }
        break

      case 'assistant': {
        const content = msg.message?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') {
              const toolName = block.name ?? 'unknown'
              if (block.id) {
                this.toolUseIdToName.set(block.id, toolName)
              }
              events.push({ type: 'tool.start', toolName })
            }
          }
          const text = content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('')
          if (text) {
            events.push({ type: 'progress', text })
          }
        }
        break
      }

      case 'user': {
        const userContent = msg.content ?? msg.message?.content
        if (Array.isArray(userContent)) {
          for (const block of userContent) {
            if (block.type === 'tool_result') {
              const toolName = this.toolUseIdToName.get(block.tool_use_id) ?? 'unknown'
              this.toolUseIdToName.delete(block.tool_use_id)

              const meta: ToolResultMeta = {
                toolName,
                isError: block.is_error === true,
                errorText: extractToolResultText(block),
              }
              toolResults.push(meta)

              events.push({
                type: 'tool.end',
                toolName: meta.toolName,
                isError: meta.isError,
              })
            }
          }
        }
        break
      }

      case 'result': {
        const text = msg.result ?? ''
        if (msg.subtype === 'success') {
          events.push({ type: 'result', text })
        } else {
          const errorMsg = Array.isArray(msg.errors) ? msg.errors.join('; ') : 'Unknown error'
          events.push({ type: 'error', message: errorMsg })
        }
        break
      }
    }

    return { events, toolResults }
  }
}

function extractToolResultText(block: { content?: unknown }): string | undefined {
  const { content } = block
  if (typeof content === 'string') {
    return content.trim() || undefined
  }
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string') return item.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()

  return text || undefined
}

/**
 * Stateless convenience wrapper (backward compat).
 * 단일 메시지만 변환할 때 사용. tool.end에서 toolName 복원 안 됨.
 */
export function mapSdkMessage(msg: any): RuntimeEvent[] {
  return new SdkMessageMapper().map(msg)
}
