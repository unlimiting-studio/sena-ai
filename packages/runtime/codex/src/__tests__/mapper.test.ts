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

  it('maps commandExecution item/completed to tool.end with toolInput and toolResponse', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'npm test', args: ['--watch'], exitCode: 0, output: 'ok' },
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'shell:npm test',
      isError: false,
      toolInput: { command: 'npm test', args: ['--watch'] },
      toolResponse: { exitCode: 0, output: 'ok' },
    })
  })

  it('maps failed command to tool.end with isError and tool data', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'commandExecution', command: 'bad-cmd', exitCode: 1, output: 'not found' },
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'shell:bad-cmd',
      isError: true,
      toolInput: { command: 'bad-cmd', args: undefined },
      toolResponse: { exitCode: 1, output: 'not found' },
    })
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

  it('maps turn/completed success using agentMessage.text when present', () => {
    const event = mapCodexNotification('turn/completed', {
      turn: {
        status: 'completed',
        items: [
          { type: 'agentMessage', text: 'Done from text field' },
        ],
      },
    })
    expect(event).toEqual({ type: 'result', text: 'Done from text field' })
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
      item: { type: 'fileChange', changes: [{ path: '/tmp/test.ts' }] }
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'file:/tmp/test.ts' })
  })

  it('maps fileChange item/completed to tool.end with toolInput and toolResponse', () => {
    const changes = [{ path: '/tmp/test.ts', content: 'new content' }]
    const event = mapCodexNotification('item/completed', {
      item: { type: 'fileChange', changes }
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'file:/tmp/test.ts',
      isError: false,
      toolInput: { path: '/tmp/test.ts' },
      toolResponse: { changes },
    })
  })

  it('maps mcpToolCall item/started to tool.start', () => {
    const event = mapCodexNotification('item/started', {
      item: { type: 'mcpToolCall', server: 'slack', tool: 'post_message' }
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'mcp:slack/post_message' })
  })

  it('maps mcpToolCall item/completed to tool.end with toolInput and toolResponse', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'mcpToolCall', server: 'slack', tool: 'post_message', error: null, arguments: { channel: '#general' }, result: { ok: true } }
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'mcp:slack/post_message',
      isError: false,
      toolInput: { channel: '#general' },
      toolResponse: { ok: true },
    })
  })

  it('maps mcpToolCall item/completed with error as toolResponse', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'mcpToolCall', server: 'slack', tool: 'post_message', error: { message: 'timeout' }, arguments: { channel: '#general' } }
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'mcp:slack/post_message',
      isError: true,
      toolInput: { channel: '#general' },
      toolResponse: { message: 'timeout' },
    })
  })

  it('maps dynamicToolCall item/started to tool.start', () => {
    const event = mapCodexNotification('item/started', {
      item: { type: 'dynamicToolCall', tool: 'custom_search' }
    })
    expect(event).toEqual({ type: 'tool.start', toolName: 'tool:custom_search' })
  })

  it('maps dynamicToolCall item/completed to tool.end with toolInput and toolResponse', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'dynamicToolCall', tool: 'custom_search', success: true, arguments: { query: 'test' }, result: { hits: 5 } }
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'tool:custom_search',
      isError: false,
      toolInput: { query: 'test' },
      toolResponse: { hits: 5 },
    })
  })

  it('maps dynamicToolCall item/completed with failure and tool data', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'dynamicToolCall', tool: 'custom_search', success: false, arguments: { query: 'bad' }, result: null }
    })
    expect(event).toEqual({
      type: 'tool.end',
      toolName: 'tool:custom_search',
      isError: true,
      toolInput: { query: 'bad' },
      toolResponse: null,
    })
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

  it('extracts text from agentMessage.text in item/completed', () => {
    const event = mapCodexNotification('item/completed', {
      item: { type: 'agentMessage', text: 'hello from text field' }
    })
    expect(event).toEqual({ type: 'progress', text: 'hello from text field' })
  })
})
