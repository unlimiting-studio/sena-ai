import type { Schedule } from './types.js'

export type CronScheduleOptions = {
  name: string
  prompt: string
  timezone?: string
}

/**
 * Creates a cron-based schedule.
 * Expression uses 5-field cron format (minute hour day month weekday).
 * Timezone defaults to UTC.
 */
export function cronSchedule(expression: string, options: CronScheduleOptions): Schedule {
  return {
    name: options.name,
    type: 'cron',
    expression,
    prompt: options.prompt,
    ...(options.timezone && { timezone: options.timezone }),
  }
}

export type HeartbeatOptions = {
  prompt: string
  name?: string
}

/**
 * Creates a fixed-interval heartbeat schedule.
 * Interval format: '15m', '1h', '30s', etc.
 */
export function heartbeat(interval: string, options: HeartbeatOptions): Schedule {
  return {
    name: options.name ?? `heartbeat:${interval}`,
    type: 'heartbeat',
    expression: interval,
    prompt: options.prompt,
  }
}
