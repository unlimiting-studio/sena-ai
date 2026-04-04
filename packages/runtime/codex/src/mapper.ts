import type { RuntimeEvent } from '@sena-ai/core'

export function mapCodexNotification(method: string, params: any): RuntimeEvent | null {
  switch (method) {
    case 'item/agentMessage/delta':
      return { type: 'progress.delta', text: params.delta ?? '' }

    case 'item/started': {
      const item = params.item
      const itemType = item?.type ?? params.type
      switch (itemType) {
        case 'commandExecution':
          return { type: 'tool.start', toolName: `shell:${item?.command ?? 'unknown'}` }
        case 'fileChange':
          return { type: 'tool.start', toolName: `file:${item?.changes?.[0]?.path ?? 'unknown'}` }
        case 'mcpToolCall':
          return { type: 'tool.start', toolName: `mcp:${item?.server ?? 'unknown'}/${item?.tool ?? 'unknown'}` }
        case 'dynamicToolCall':
          return { type: 'tool.start', toolName: `tool:${item?.tool ?? 'unknown'}` }
        default:
          return null
      }
    }

    case 'item/completed': {
      const item = params.item
      if (!item) return null
      switch (item.type) {
        case 'commandExecution':
          return {
            type: 'tool.end',
            toolName: `shell:${item.command ?? 'unknown'}`,
            isError: item.exitCode != null ? item.exitCode !== 0 : false,
            toolInput: { command: item.command, args: item.args },
            toolResponse: { exitCode: item.exitCode, output: item.output },
          }
        case 'fileChange':
          return {
            type: 'tool.end',
            toolName: `file:${item.changes?.[0]?.path ?? 'unknown'}`,
            isError: false,
            toolInput: { path: item.changes?.[0]?.path },
            toolResponse: { changes: item.changes },
          }
        case 'mcpToolCall':
          return {
            type: 'tool.end',
            toolName: `mcp:${item.server ?? 'unknown'}/${item.tool ?? 'unknown'}`,
            isError: item.error != null,
            toolInput: item.arguments,
            toolResponse: item.error ?? item.result,
          }
        case 'dynamicToolCall':
          return {
            type: 'tool.end',
            toolName: `tool:${item.tool ?? 'unknown'}`,
            isError: item.success === false,
            toolInput: item.arguments,
            toolResponse: item.result,
          }
        case 'agentMessage': {
          const text = item.content
            ?.filter((b: any) => b.type === 'text')
            ?.map((b: any) => b.text)
            ?.join('') ?? ''
          if (text) return { type: 'progress', text }
          return null
        }
        default:
          return null
      }
    }

    case 'turn/completed': {
      const turn = params.turn
      if (!turn) return null
      if (turn.status === 'completed') {
        const agentItems = (turn.items ?? []).filter((i: any) => i.type === 'agentMessage')
        const lastMsg = agentItems[agentItems.length - 1]
        const text = lastMsg?.content
          ?.filter((b: any) => b.type === 'text')
          ?.map((b: any) => b.text)
          ?.join('') ?? ''
        return { type: 'result', text }
      }
      if (turn.status === 'failed') {
        return { type: 'error', message: turn.error ?? 'Turn failed' }
      }
      return { type: 'error', message: 'Turn interrupted' }
    }

    case 'error':
      return { type: 'error', message: params.error?.message ?? 'Unknown error' }

    default:
      return null
  }
}
