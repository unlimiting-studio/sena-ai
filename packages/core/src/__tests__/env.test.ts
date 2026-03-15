import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env, validateEnv, resetEnvCollector } from '../env.js'

describe('env()', () => {
  beforeEach(() => {
    resetEnvCollector()
  })

  it('returns env value when set', () => {
    process.env.TEST_KEY = 'hello'
    expect(env('TEST_KEY')).toBe('hello')
    delete process.env.TEST_KEY
  })

  it('returns default value when env is missing', () => {
    delete process.env.MISSING_KEY
    expect(env('MISSING_KEY', 'fallback')).toBe('fallback')
  })

  it('collects missing required env vars', () => {
    delete process.env.REQUIRED_A
    delete process.env.REQUIRED_B
    env('REQUIRED_A')
    env('REQUIRED_B')
    expect(() => validateEnv()).toThrow(/REQUIRED_A.*REQUIRED_B/s)
  })

  it('does not throw when all required vars are present', () => {
    process.env.PRESENT = 'yes'
    env('PRESENT')
    expect(() => validateEnv()).not.toThrow()
    delete process.env.PRESENT
  })
})
