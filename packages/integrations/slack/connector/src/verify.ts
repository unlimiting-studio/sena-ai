import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifySignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!timestamp || !signature) return false

  // Check timestamp to prevent replay attacks (5 minutes)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false

  const sigBasestring = `v0:${timestamp}:${rawBody}`
  const mySignature = 'v0=' + createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex')

  try {
    return timingSafeEqual(Buffer.from(mySignature), Buffer.from(signature))
  } catch {
    return false
  }
}
