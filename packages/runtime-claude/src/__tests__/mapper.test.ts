import { describe, it, expect } from 'vitest'
import { mapSdkMessage } from '../mapper.js'

describe('mapSdkMessage', () => {
  it('maps system init to session.init', () => {
    const events = mapSdkMessage({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-123',
      tools: [],
      mcp_servers: [],
      model: 'claude-sonnet-4-5',
    })
    expect(events).toEqual([{ type: 'session.init', sessionId: 'sess-123' }])
  })

  it('maps assistant text to progress', () => {
    const events = mapSdkMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    })
    expect(events).toEqual([{ type: 'progress', text: 'Hello world' }])
  })

  it('maps assistant tool_use to tool.start', () => {
    const events = mapSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'Reading file...' },
        ],
      },
    })
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'tool.start', toolName: 'Read' })
    expect(events[1]).toEqual({ type: 'progress', text: 'Reading file...' })
  })

  it('maps success result to result', () => {
    const events = mapSdkMessage({
      type: 'result',
      subtype: 'success',
      result: 'Final answer',
      session_id: 'sess-123',
    })
    expect(events).toEqual([{ type: 'result', text: 'Final answer' }])
  })

  it('maps error result to error', () => {
    const events = mapSdkMessage({
      type: 'result',
      subtype: 'error_max_turns',
      errors: ['Max turns reached'],
      session_id: 'sess-123',
    })
    expect(events).toEqual([{ type: 'error', message: 'Max turns reached' }])
  })

  it('returns empty array for unknown message types', () => {
    expect(mapSdkMessage({ type: 'unknown' })).toEqual([])
  })
})
