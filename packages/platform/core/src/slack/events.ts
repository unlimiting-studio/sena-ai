import { Hono } from 'hono'
import type { Vault } from '../types/vault.js'
import type { RelayHub } from '../types/relay.js'
import type { CryptoProvider } from '../types/crypto.js'
import type { BotRepository } from '../types/repository.js'

/**
 * Slack HTTP Events API receiver + relay to SSE/WebSocket Hub.
 *
 * Route: POST /slack/events/:botId
 * - url_verification challenge auto-response
 * - signing_secret signature verification
 * - Relay to local runtime via RelayHub
 */
export function createSlackEventsHandler(
  botRepo: BotRepository,
  vault: Vault,
  relay: RelayHub,
  crypto: CryptoProvider,
) {
  const app = new Hono()

  app.post('/slack/events/:botId', async (c) => {
    const botId = c.req.param('botId')
    const rawBody = await c.req.text()

    const bot = await botRepo.findByIdAndStatus(botId, 'active')
    if (!bot) {
      return c.json({ error: 'unknown bot' }, 404)
    }

    // Signing secret verification
    if (bot.signingSecretEnc) {
      const signingSecret = await vault.decrypt(bot.signingSecretEnc)
      const timestamp = c.req.header('x-slack-request-timestamp')
      const slackSignature = c.req.header('x-slack-signature')

      if (!timestamp || !slackSignature) {
        return c.json({ error: 'missing slack signature headers' }, 401)
      }

      // Only allow requests within 5 minutes (replay attack prevention)
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - Number(timestamp)) > 300) {
        return c.json({ error: 'request too old' }, 401)
      }

      const basestring = `v0:${timestamp}:${rawBody}`
      const hmac = await crypto.hmacSha256(signingSecret, basestring)
      const computed = `v0=${hmac}`

      const isValid = await crypto.timingSafeEqual(computed, slackSignature)
      if (!isValid) {
        return c.json({ error: 'invalid signature' }, 401)
      }
    }

    const payload = JSON.parse(rawBody) as {
      type: string
      challenge?: string
      event?: unknown
      event_id?: string
      event_time?: number
      team_id?: string
    }

    // URL verification challenge
    if (payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge })
    }

    // event_callback -> relay to local runtime
    if (payload.type === 'event_callback') {
      const dispatched = relay.dispatch(botId, {
        type: payload.type,
        event: payload.event,
        event_id: payload.event_id,
        event_time: payload.event_time,
        team_id: payload.team_id,
      })

      if (!dispatched) {
        console.warn(`[events] bot ${botId} not connected, event dropped`)
      }
    }

    // Slack expects 200 within 3 seconds
    return c.json({ ok: true })
  })

  return app
}
