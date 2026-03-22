import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createScheduler, matchField, matchesCron } from '../scheduler.js'
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

  it('fires immediately on start, then repeats on interval', async () => {
    const onTurn = vi.fn().mockResolvedValue(mockTrace())

    const schedule: Schedule = {
      name: 'test-heartbeat',
      type: 'heartbeat',
      expression: '1s',
      prompt: 'heartbeat check',
    }

    const scheduler = createScheduler({ schedules: [schedule], onTurn })
    scheduler.start()

    // Immediate fire on start
    await vi.advanceTimersByTimeAsync(0)
    expect(onTurn).toHaveBeenCalledTimes(1)
    expect(onTurn).toHaveBeenCalledWith(expect.objectContaining({
      input: 'heartbeat check',
      trigger: 'schedule',
      schedule: { name: 'test-heartbeat', type: 'heartbeat' },
    }))

    // First interval tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(2)

    // Second interval tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(3)

    scheduler.stop()
  })

  it('stops executing after stop()', async () => {
    const onTurn = vi.fn().mockResolvedValue(mockTrace())

    const scheduler = createScheduler({
      schedules: [{ name: 'test', type: 'heartbeat', expression: '1s', prompt: 'check' }],
      onTurn,
    })
    scheduler.start()

    // Immediate fire + 1 interval tick
    await vi.advanceTimersByTimeAsync(1000)
    expect(onTurn).toHaveBeenCalledTimes(2)

    scheduler.stop()

    await vi.advanceTimersByTimeAsync(5000)
    expect(onTurn).toHaveBeenCalledTimes(2) // No more calls
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

describe('matchField', () => {
  it('matches wildcard', () => {
    expect(matchField('*', 5)).toBe(true)
  })
  it('matches exact value', () => {
    expect(matchField('5', 5)).toBe(true)
    expect(matchField('5', 6)).toBe(false)
  })
  it('matches step values', () => {
    expect(matchField('*/5', 0)).toBe(true)
    expect(matchField('*/5', 5)).toBe(true)
    expect(matchField('*/5', 10)).toBe(true)
    expect(matchField('*/5', 3)).toBe(false)
  })
  it('matches ranges', () => {
    expect(matchField('1-5', 1)).toBe(true)
    expect(matchField('1-5', 3)).toBe(true)
    expect(matchField('1-5', 5)).toBe(true)
    expect(matchField('1-5', 0)).toBe(false)
    expect(matchField('1-5', 6)).toBe(false)
  })
  it('matches lists', () => {
    expect(matchField('1,3,5', 1)).toBe(true)
    expect(matchField('1,3,5', 3)).toBe(true)
    expect(matchField('1,3,5', 2)).toBe(false)
  })
})

describe('matchesCron', () => {
  it('matches every-minute wildcard', () => {
    expect(matchesCron('* * * * *', new Date('2026-03-15T10:30:00Z'), 'UTC')).toBe(true)
  })
  it('matches specific minute and hour', () => {
    expect(matchesCron('30 10 * * *', new Date('2026-03-15T10:30:00Z'), 'UTC')).toBe(true)
    expect(matchesCron('30 10 * * *', new Date('2026-03-15T10:31:00Z'), 'UTC')).toBe(false)
  })
  it('matches day of week (0=Sunday)', () => {
    // 2026-03-15 is a Sunday
    expect(matchesCron('* * * * 0', new Date('2026-03-15T10:00:00Z'), 'UTC')).toBe(true)
    expect(matchesCron('* * * * 1', new Date('2026-03-15T10:00:00Z'), 'UTC')).toBe(false)
  })
  it('matches step in minutes', () => {
    expect(matchesCron('*/15 * * * *', new Date('2026-03-15T10:00:00Z'), 'UTC')).toBe(true)
    expect(matchesCron('*/15 * * * *', new Date('2026-03-15T10:15:00Z'), 'UTC')).toBe(true)
    expect(matchesCron('*/15 * * * *', new Date('2026-03-15T10:07:00Z'), 'UTC')).toBe(false)
  })
})
