import { Hono } from 'hono'
import type { Vault } from '../types/vault.js'
import type { BotRepository } from '../types/repository.js'

/**
 * Slack API proxy.
 * Local runtimes send POST /relay/api with Slack API calls.
 * The proxy decrypts the bot_token from Vault and forwards the request.
 */
export function createApiProxy(botRepo: BotRepository, vault: Vault) {
  const app = new Hono()

  app.post('/relay/api', async (c) => {
    const connectKey = c.req.header('x-connect-key')
    if (!connectKey) {
      return c.json(
        { ok: false, error: 'missing x-connect-key header' },
        401,
      )
    }

    const bot = await botRepo.findByConnectKeyAndStatus(connectKey, 'active')
    if (!bot) {
      return c.json(
        { ok: false, error: 'invalid connect_key or bot not active' },
        401,
      )
    }

    if (!bot.botTokenEnc) {
      return c.json({ ok: false, error: 'bot has no token configured' }, 500)
    }

    const botToken = await vault.decrypt(bot.botTokenEnc)

    const body = await c.req.json<{
      method: string
      params: Record<string, unknown>
    }>()

    if (!body.method) {
      return c.json({ ok: false, error: 'missing method field' }, 400)
    }

    const slackUrl = `https://slack.com/api/${body.method}`

    const slackRes = await fetch(slackUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body.params || {}),
    })

    const slackData = await slackRes.json()
    return c.json(slackData as Record<string, unknown>)
  })

  return app
}
