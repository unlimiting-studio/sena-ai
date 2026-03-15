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

  it('maps "error" notification (ErrorNotification format)', () => {
    const event = mapCodexNotification('error', {
      error: { message: 'Rate limit exceeded' },
      willRetry: false,
      threadId: 'thr_1',
      turnId: 'turn_1',
    })
    expect(event).toEqual({ type: 'error', message: 'Rate limit exceeded' })
  })

  it('returns null for unrelated notifications', () => {
    expect(mapCodexNotification('thread/name/updated', {})).toBeNull()
    expect(mapCodexNotification('account/updated', {})).toBeNull()
  })

  it('maps fileChange item/started to tool.start', () => {
    const event = mapCodexNotification('item/started', {
      item: { type: 'fileChange', path: '/tmp/test.ts' }
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'file:/tmp/test.ts' })
  })

  it('maps fileChange item/completed to tool.end', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'fileChange', path: '/tmp/test.ts' }
    })
    expect(event).toEqual({ type: 'tool.end', toolName: 'file:/tmp/test.ts', isError: false })
  })

  it('returns null for item/started with unrecognized type', () => {
    expect(mapCodexNotification('item/started', { item: { type: 'userMessage' } })).toBeNull()
  })

  it('returns null for item/completed with null item', () => {
    expect(mapCodexNotification('item/completed', {})).toBeNull()
  })

  it('handles turn/completed with empty items array', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: { status: 'completed', items: [] }
    })
    expect(event).toEqual({ type: 'result', text: '' })
  })

  it('extracts text from agentMessage in item/completed', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'agentMessage', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }] }
    })
    expect(event).toEqual({ type: 'progress', text: 'hello world' })
  })
})
