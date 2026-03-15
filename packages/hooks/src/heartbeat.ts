import type { Schedule } from '@sena-ai/core'

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
