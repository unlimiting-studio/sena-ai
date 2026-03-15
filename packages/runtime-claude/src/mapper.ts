import type { RuntimeEvent } from '@sena-ai/core'

/**
 * Claude Agent SDK의 SDKMessage를 Sena RuntimeEvent 배열로 변환한다.
 */
export function mapSdkMessage(msg: any): RuntimeEvent[] {
  const events: RuntimeEvent[] = []

  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init' && msg.session_id) {
        events.push({ type: 'session.init', sessionId: msg.session_id })
      }
      break

    case 'assistant': {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_use') {
            events.push({ type: 'tool.start', toolName: block.name ?? 'unknown' })
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
