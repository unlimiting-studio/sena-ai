import { describe, it, expect } from 'vitest'
import { verifySignature } from '../verify.js'
import { createHmac } from 'node:crypto'

describe('verifySignature', () => {
  const secret = 'test-signing-secret'
  const body = '{"type":"url_verification"}'
  const timestamp = String(Math.floor(Date.now() / 1000))

  function makeSignature(ts: string, rawBody: string): string {
    return 'v0=' + createHmac('sha256', secret)
      .update(`v0:${ts}:${rawBody}`)
      .digest('hex')
  }

  it('returns true for valid signature', () => {
    const sig = makeSignature(timestamp, body)
    expect(verifySignature(secret, timestamp, body, sig)).toBe(true)
  })

  it('returns false for invalid signature', () => {
    expect(verifySignature(secret, timestamp, body, 'v0=invalid')).toBe(false)
  })

  it('returns false for expired timestamp', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600)
    const sig = makeSignature(oldTimestamp, body)
    expect(verifySignature(secret, oldTimestamp, body, sig)).toBe(false)
  })

  it('returns false for missing params', () => {
    expect(verifySignature(secret, '', body, 'v0=abc')).toBe(false)
    expect(verifySignature(secret, timestamp, body, '')).toBe(false)
  })
})
