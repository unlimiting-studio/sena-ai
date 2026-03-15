import { describe, it, expect } from 'vitest'
import { mapCodexNotification } from '../mapper.js'

describe('mapCodexNotification', () => {
  it('maps agentMessage delta to progress.delta', () => {
    const event = mapCodexNotification('item/agentMessage/delta', {
      threadId: 'thr_1', turnId: 'turn_1', itemId: 'item_1',
      delta: 'Hello ',
    })
    expect(event).toEqual({ type: 'progress.delta', text: 'Hello ' })
  })

  it('maps commandExecution item/started to tool.start', () => {
    const event = mapCodexNotification('item/started', {
      item: { type: 'commandExecution', command: 'ls -la' },
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'shell:ls -la' })
  })

  it('maps commandExecution item/completed to tool.end', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'npm test', exitCode: 0 },
    })
    expect(event).toEqual({ type: 'tool.end', toolName: 'shell:npm test', isError: false })
  })

  it('maps failed command to tool.end with isError', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'bad-cmd', exitCode: 1 },
    })
    expect(event).toEqual({ type: 'tool.end', toolName: 'shell:bad-cmd', isError: true })
  })

  it('maps turn/completed success to result', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: {
        status: 'completed',
        items: [
          { type: 'agentMessage', content: [{ type: 'text', text: 'Done!' }] },
        ],
      },
    })
    expect(event).toEqual({ type: 'result', text: 'Done!' })
  })

  it('maps turn/completed failed to error', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: { status: 'failed', error: 'Context window exceeded' },
    })
    expect(event).toEqual({ type: 'error', message: 'Context window exceeded' })
  })

  it('maps codex/event/error notification to error event', () => {
    const event = mapCodexNotification('codex/event/error', {
      msg: { message: 'Server crashed' },
    })
    expect(event).toEqual({ type: 'error', message: 'Server crashed' })
  })

  it('returns null for unrelated notifications', () => {
    expect(mapCodexNotification('thread/name/updated', {})).toBeNull()
    expect(mapCodexNotification('account/updated', {})).toBeNull()
  })
})
