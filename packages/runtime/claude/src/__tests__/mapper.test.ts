import { describe, it, expect } from 'vitest'
import { mapSdkMessage, SdkMessageMapper } from '../mapper.js'

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

describe('SdkMessageMapper', () => {
  it('maps tool_result to tool.end with correct toolName via id tracking', () => {
    const mapper = new SdkMessageMapper()

    // First: assistant sends tool_use with id and name
    const startEvents = mapper.map({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_abc123', name: 'Write' },
        ],
      },
    })
    expect(startEvents).toEqual([{ type: 'tool.start', toolName: 'Write' }])

    // Then: user sends tool_result referencing the same id
    const endEvents = mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_abc123', is_error: false },
      ],
    })
    expect(endEvents).toEqual([{ type: 'tool.end', toolName: 'Write', isError: false }])
  })

  it('marks tool.end as error when is_error is true', () => {
    const mapper = new SdkMessageMapper()

    mapper.map({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_err1', name: 'Edit' }],
      },
    })

    const endEvents = mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_err1', is_error: true },
      ],
    })
    expect(endEvents).toEqual([{ type: 'tool.end', toolName: 'Edit', isError: true }])
  })

  it('returns unknown toolName for untracked tool_use_id', () => {
    const mapper = new SdkMessageMapper()

    const endEvents = mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_unknown', is_error: false },
      ],
    })
    expect(endEvents).toEqual([{ type: 'tool.end', toolName: 'unknown', isError: false }])
  })

  it('tracks multiple concurrent tool calls correctly', () => {
    const mapper = new SdkMessageMapper()

    // Two tool_use blocks in one assistant message
    mapper.map({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'Read' },
          { type: 'tool_use', id: 'toolu_2', name: 'Write' },
        ],
      },
    })

    // Results come back
    const endEvents = mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_2', is_error: false },
        { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false },
      ],
    })
    expect(endEvents).toEqual([
      { type: 'tool.end', toolName: 'Write', isError: false },
      { type: 'tool.end', toolName: 'Read', isError: false },
    ])
  })

  it('cleans up id mapping after tool.end', () => {
    const mapper = new SdkMessageMapper()

    mapper.map({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'toolu_once', name: 'Edit' }],
      },
    })

    // First result — should resolve
    mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_once', is_error: false },
      ],
    })

    // Second result with same id — should be unknown (already cleaned up)
    const secondEnd = mapper.map({
      type: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_once', is_error: false },
      ],
    })
    expect(secondEnd).toEqual([{ type: 'tool.end', toolName: 'unknown', isError: false }])
  })
})
