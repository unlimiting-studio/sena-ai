const missingVars: string[] = []

export function env(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (value !== undefined) return value
  if (defaultValue !== undefined) return defaultValue
  missingVars.push(key)
  return ''
}

export function validateEnv(): void {
  if (missingVars.length > 0) {
    const list = missingVars.join('\n  - ')
    const err = new Error(`Missing required environment variables:\n  - ${list}`)
    err.name = 'EnvValidationError'
    throw err
  }
}

export function resetEnvCollector(): void {
  missingVars.length = 0
}
