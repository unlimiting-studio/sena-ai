import type { Schedule } from '@sena-ai/core'

export type CronScheduleOptions = {
  name: string
  prompt: string
}

/**
 * Creates a cron-based schedule.
 * Expression uses 5-field cron format (minute hour day month weekday).
 * Timezone defaults to Asia/Seoul.
 */
export function cronSchedule(expression: string, options: CronScheduleOptions): Schedule {
  return {
    name: options.name,
    type: 'cron',
    expression,
    prompt: options.prompt,
  }
}
