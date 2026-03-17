import { describe, it, expect } from 'vitest'
import { cronSchedule } from '@sena-ai/core'
import { heartbeat } from '@sena-ai/core'

describe('cronSchedule', () => {
  it('creates a cron schedule', () => {
    const schedule = cronSchedule('0 * * * *', {
      name: 'hourly-check',
      prompt: 'Do the hourly check',
    })

    expect(schedule.name).toBe('hourly-check')
    expect(schedule.type).toBe('cron')
    expect(schedule.expression).toBe('0 * * * *')
    expect(schedule.prompt).toBe('Do the hourly check')
  })
})

describe('heartbeat', () => {
  it('creates a heartbeat schedule', () => {
    const schedule = heartbeat('15m', {
      prompt: 'Check heartbeat',
    })

    expect(schedule.name).toBe('heartbeat:15m')
    expect(schedule.type).toBe('heartbeat')
    expect(schedule.expression).toBe('15m')
    expect(schedule.prompt).toBe('Check heartbeat')
  })

  it('allows custom name', () => {
    const schedule = heartbeat('30s', {
      name: 'fast-poll',
      prompt: 'Poll fast',
    })

    expect(schedule.name).toBe('fast-poll')
  })
})
