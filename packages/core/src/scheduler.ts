import type { Schedule, TurnTrace } from './types.js'
import type { ProcessTurnOptions } from './engine.js'

export type SchedulerOptions = {
  schedules: Schedule[]
  onTurn: (options: ProcessTurnOptions) => Promise<TurnTrace>
  timezone?: string
}

type ScheduleEntry = {
  schedule: Schedule
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null
  running: boolean
}

export function matchField(field: string, value: number): boolean {
  if (field === '*') return true

  // Handle step values: */5
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10)
    return value % step === 0
  }

  // Handle ranges: 1-5
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    return value >= start && value <= end
  }

  // Handle lists: 1,3,5
  if (field.includes(',')) {
    return field.split(',').map(Number).includes(value)
  }

  return parseInt(field, 10) === value
}

export function matchesCron(expression: string, date: Date, timezone?: string): boolean {
  const tz = timezone ?? 'UTC'
  // Convert to timezone
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }))
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.split(' ')

  return (
    matchField(minute, tzDate.getMinutes()) &&
    matchField(hour, tzDate.getHours()) &&
    matchField(dayOfMonth, tzDate.getDate()) &&
    matchField(month, tzDate.getMonth() + 1) &&
    matchField(dayOfWeek, tzDate.getDay())
  )
}

export function createScheduler(options: SchedulerOptions) {
  const { onTurn, timezone = 'UTC' } = options
  const entries: ScheduleEntry[] = []
  let stopped = false

  function parseInterval(expr: string): number {
    const match = expr.match(/^(\d+)(s|m|h)$/)
    if (!match) throw new Error(`Invalid interval format: ${expr}. Use "30s", "15m", or "1h".`)
    const [, num, unit] = match
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 }
    return parseInt(num, 10) * multipliers[unit]
  }

  async function executeTurn(schedule: Schedule, entry: ScheduleEntry): Promise<void> {
    if (stopped || entry.running) return
    entry.running = true

    try {
      await onTurn({
        input: schedule.prompt,
        trigger: 'schedule',
        schedule: {
          name: schedule.name,
          type: schedule.type,
        },
      })
    } catch (err) {
      console.error(`Schedule "${schedule.name}" failed:`, err)
    } finally {
      entry.running = false
    }
  }

  function start(): void {
    stopped = false

    for (const schedule of options.schedules) {
      const entry: ScheduleEntry = { schedule, timer: null, running: false }

      if (schedule.type === 'heartbeat') {
        const intervalMs = parseInterval(schedule.expression)
        // Fire immediately on start, then repeat on interval
        executeTurn(schedule, entry)
        entry.timer = setInterval(() => executeTurn(schedule, entry), intervalMs)
      } else if (schedule.type === 'cron') {
        // Check every minute for cron matches
        entry.timer = setInterval(() => {
          if (matchesCron(schedule.expression, new Date(), schedule.timezone ?? timezone)) {
            executeTurn(schedule, entry)
          }
        }, 60_000)
      }

      entries.push(entry)
    }
  }

  function stop(): void {
    stopped = true
    for (const entry of entries) {
      if (entry.timer) clearInterval(entry.timer)
      entry.timer = null
    }
    entries.length = 0
  }

  // Hot reload: replace schedules without full restart
  function reload(newSchedules: Schedule[]): void {
    stop()
    options.schedules = newSchedules
    start()
  }

  return { start, stop, reload }
}
