import type { RuntimeEvent } from '@sena-ai/core'

export function mapCodexNotification(method: string, params: any): RuntimeEvent | null {
  switch (method) {
    case 'item/agentMessage/delta':
      return { type: 'progress.delta', text: params.delta ?? '' }

    case 'item/started': {
      const itemType = params.item?.type ?? params.type
      if (itemType === 'commandExecution' || itemType === 'fileChange') {
        const toolName = itemType === 'commandExecution'
          ? `shell:${params.item?.command ?? 'unknown'}`
          : `file:${params.item?.path ?? 'unknown'}`
        return { type: 'tool.start', toolName }
      }
      return null
    }

    case 'item/completed': {
      const item = params.item
      if (!item) return null
      const itemType = item.type
      if (itemType === 'commandExecution' || itemType === 'fileChange') {
        const toolName = itemType === 'commandExecution'
          ? `shell:${item.command ?? 'unknown'}`
          : `file:${item.path ?? 'unknown'}`
        const isError = item.exitCode !== undefined ? item.exitCode !== 0 : false
        return { type: 'tool.end', toolName, isError }
      }
      if (itemType === 'agentMessage') {
        const text = item.content
          ?.filter((b: any) => b.type === 'text')
          ?.map((b: any) => b.text)
          ?.join('') ?? ''
        if (text) {
          return { type: 'progress', text }
        }
      }
      return null
    }

    // Official: 'turn/completed' per ServerNotification.ts.
    // Legacy/observed: 'turn/ended' kept as defensive fallback.
    case 'turn/completed':
    case 'turn/ended': {
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

    // Official: 'error' per ServerNotification.ts → ErrorNotification.
    // Params: { error: TurnError, willRetry: boolean, threadId, turnId }
    case 'error':
      return { type: 'error', message: params.error?.message ?? 'Unknown error' }

    // Legacy/observed: 'codex/event/error' — kept as defensive fallback.
    case 'codex/event/error':
      return { type: 'error', message: params.msg?.message ?? params.error?.message ?? 'Unknown error' }

    default:
      return null
  }
}
