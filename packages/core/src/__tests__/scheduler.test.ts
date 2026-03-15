import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createScheduler } from '../scheduler.js'
import type { Schedule, TurnTrace } from '../types.js'

function mockTrace(): TurnTrace {
  return {
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
    agentName: 'test',
    trigger: 'schedule',
    input: 'test prompt',
    hooks: [],
    assembledContext: '',
    result: { text: 'ok', sessionId: null, durationMs: 0, toolCalls: [] },
    error: null,
  }
}

describe('createScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes heartbeat on interval', async () => {
    const onTurn = vi.fn().mockResolvedValue(mockTrace())

    const schedule: Schedule = {
      name: 'test-heartbeat',
      type: 'heartbeat',
      expression: '1s',
      prompt: 'heartbeat check',
    }

    const scheduler = createScheduler({ schedules: [schedule], onTurn })
    scheduler.start()

    // Advance 1 second
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(1)
    expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({
      input: 'heartbeat check',
      trigger: 'schedule',
      schedule: { name: 'test-heartbeat', type: 'heartbeat' },
    }))

    // Advance another second
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })

  it('stops executing after stop()', async () => {
    const onTurn = vi.fn().mockResolvedValue(mockTrace())

    const scheduler = createScheduler({
      schedules: [{ name: 'test', type: 'heartbeat', expression: '1s', prompt: 'check' }],
      onTurn,
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(1)

    scheduler.stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(onTurn).toHaveBeenCalledTimes(1) // No more calls
  })

  it('reloads schedules', async () => {
    const onTurn = vi.fn().mockResolvedValue(mockTrace())

    const scheduler = createScheduler({
      schedules: [{ name: 'old', type: 'heartbeat', expression: '1s', prompt: 'old' }],
      onTurn,
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({ input: 'old' }))

    scheduler.reload([{ name: 'new', type: 'heartbeat', expression: '2s', prompt: 'new' }])

    await vi.advanceTimersByTimeAsync(2000)
    expect(onTurn).toHaveBeenLastCalledWith(expect.objectContaining({ input: 'new' }))

    scheduler.stop()
  })

  it('does not run duplicate if previous run is still going', async () => {
    let resolveFirst: () => void
    const firstCall = new Promise<void>((r) => { resolveFirst = r })
    const onTurn = vi.fn()
      .mockImplementationOnce(() => firstCall.then(() => mockTrace()))
      .mockResolvedValue(mockTrace())

    const scheduler = createScheduler({
      schedules: [{ name: 'slow', type: 'heartbeat', expression: '1s', prompt: 'check' }],
      onTurn,
    })
    scheduler.start()

    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(1)

    // Second tick while first is still running
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(1) // Skipped because still running

    resolveFirst!()
    await vi.advanceTimersByTimeAsync(0)

    // Third tick — now it should run
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(2)

    scheduler.stop()
  })
})
