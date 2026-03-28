import type { RuntimeEvent } from '@sena-ai/core'

/**
 * Claude Agent SDK의 SDKMessage를 Sena RuntimeEvent 배열로 변환한다.
 *
 * Stateful: tool_use id → name 매핑을 유지하여 tool_result에서 toolName을 복원한다.
 */
export class SdkMessageMapper {
  /** tool_use block id → tool name */
  private toolUseIdToName = new Map<string, string>()

  map(msg: any): RuntimeEvent[] {
    const events: RuntimeEvent[] = []

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
              events.push({
                type: 'tool.end',
                toolName,
                isError: block.is_error === true,
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

    return events
  }
}

/**
 * Stateless convenience wrapper (backward compat).
 * 단일 메시지만 변환할 때 사용. tool.end에서 toolName 복원 안 됨.
 */
export function mapSdkMessage(msg: any): RuntimeEvent[] {
  return new SdkMessageMapper().map(msg)
}
