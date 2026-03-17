export const VERSION = '0.0.1'

export { fileContext } from './fileContext.js'
export type { FileContextOptions } from './fileContext.js'
export { traceLogger } from './traceLogger.js'
export type { TraceLoggerOptions } from './traceLogger.js'

// Re-export from @sena-ai/core for backwards compatibility
export { cronSchedule, heartbeat } from '@sena-ai/core'
export type { CronScheduleOptions, HeartbeatOptions } from '@sena-ai/core'
