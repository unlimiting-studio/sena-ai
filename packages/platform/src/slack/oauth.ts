import { Hono } from 'hono'
import type { Vault } from '../types/vault.js'
import type { CryptoProvider } from '../types/crypto.js'
import type {
  BotRepository,
  OAuthStateRepository,
} from '../types/repository.js'

type OAuthAccessResponse = {
  ok: boolean
  access_token?: string
  team?: { id: string; name: string }
  bot_user_id?: string
  error?: string
}

/**
 * Slack OAuth 2.0 handler.
 *
 * Flow:
 * 1. GET /oauth/start/:botId -> Redirect to Slack auth page
 * 2. Slack approves -> GET /oauth/callback -> acquire bot_token -> save to Vault
 */
export function createOAuthHandler(
  botRepo: BotRepository,
  vault: Vault,
  crypto: CryptoProvider,
  oauthStates: OAuthStateRepository,
  platformBaseUrl: string,
) {
  const app = new Hono()

  app.get('/oauth/start/:botId', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)

    if (!bot || !bot.clientId) {
      return c.json({ error: 'bot not found or not provisioned' }, 404)
    }

    // Clean up expired states
    await oauthStates.deleteExpired()

    const state = await crypto.randomHex(16)
    await oauthStates.create({
      state,
      botId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })

    const redirectUri = `${platformBaseUrl}/oauth/callback`
    const scopes = [
      'app_mentions:read',
      'chat:write',
      'chat:write.public',
      'channels:history',
      'channels:read',
      'channels:join',
      'groups:history',
      'groups:read',
      'im:history',
      'im:read',
      'im:write',
      'reactions:read',
      'reactions:write',
      'files:read',
      'files:write',
      'users:read',
    ].join(',')

    const slackUrl = new URL('https://slack.com/oauth/v2/authorize')
    slackUrl.searchParams.set('client_id', bot.clientId)
    slackUrl.searchParams.set('scope', scopes)
    slackUrl.searchParams.set('state', state)
    slackUrl.searchParams.set('redirect_uri', redirectUri)

    return c.redirect(slackUrl.toString())
  })

  app.get('/oauth/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')

    if (!code || !state) {
      return c.json({ error: 'missing code or state' }, 400)
    }

    await oauthStates.deleteExpired()
    const entry = await oauthStates.consume(state)
    if (!entry) {
      return c.json({ error: 'invalid or expired state' }, 400)
    }

    const bot = await botRepo.findById(entry.botId)
    if (!bot || !bot.clientId || !bot.clientSecretEnc) {
      return c.json({ error: 'bot configuration incomplete' }, 500)
    }

    const clientSecret = await vault.decrypt(bot.clientSecretEnc)
    const redirectUri = `${platformBaseUrl}/oauth/callback`

    // Exchange code for token
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: bot.clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    })

    const data = (await res.json()) as OAuthAccessResponse

    if (!data.ok || !data.access_token) {
      return c.json({ error: `Slack OAuth failed: ${data.error}` }, 400)
    }

    // Save bot token to Vault and activate
    await botRepo.update(entry.botId, {
      botTokenEnc: await vault.encrypt(data.access_token),
      slackTeamId: data.team?.id ?? null,
      status: 'active',
    })

    // Redirect to completion page
    return c.redirect(`/bots/${entry.botId}/complete`)
  })

  return app
}
