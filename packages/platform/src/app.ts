import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Platform, AppConfig } from './types/platform.js'
import { createApiProxy } from './relay/api-proxy.js'
import { createSlackEventsHandler } from './slack/events.js'
import { createOAuthHandler } from './slack/oauth.js'
import { createProvisioner, type Provisioner } from './slack/provisioner.js'
import { createPages } from './web/pages.js'
import { createWebApi } from './web/api.js'

export interface CreateAppResult {
  app: Hono
  provisioner: Provisioner
}

/**
 * Create the main Hono application with all routes wired up.
 * Works in both Node.js and CF Workers environments.
 */
export function createApp(
  platform: Platform,
  config: AppConfig,
): CreateAppResult {
  const app = new Hono()
  app.use('*', logger())

  const provisioner = createProvisioner(
    platform.bots,
    platform.configTokens,
    platform.vault,
    config.platformBaseUrl,
  )

  // Serve bootstrap script at /install.sh
  if (config.bootstrapScript) {
    const scriptContent = config.bootstrapScript
    app.get('/install.sh', (c) => {
      c.header('Content-Type', 'text/plain; charset=utf-8')
      return c.body(scriptContent)
    })
  }

  // Health check
  app.get('/health', (c) =>
    c.json({
      ok: true,
      connectedBots: platform.relay.connectedBots().length,
      ts: new Date().toISOString(),
    }),
  )

  // SSE/WebSocket relay stream endpoint
  app.get('/relay/stream', async (c) => {
    const connectKey =
      c.req.header('x-connect-key') || c.req.query('connect_key')
    if (!connectKey) {
      return c.json({ error: 'missing connect_key' }, 401)
    }

    const bot = await platform.bots.findByConnectKeyAndStatus(
      connectKey,
      'active',
    )
    if (!bot) {
      return c.json({ error: 'invalid connect_key or bot not active' }, 401)
    }

    return platform.relay.handleStream(c, bot.id, connectKey)
  })

  // Slack API proxy
  app.route('/', createApiProxy(platform.bots, platform.vault))

  // Slack events
  app.route(
    '/',
    createSlackEventsHandler(
      platform.bots,
      platform.vault,
      platform.relay,
      platform.crypto,
    ),
  )

  // OAuth
  app.route(
    '/',
    createOAuthHandler(
      platform.bots,
      platform.vault,
      platform.crypto,
      platform.oauthStates,
      config.platformBaseUrl,
    ),
  )

  // Web API
  app.route(
    '/',
    createWebApi(
      platform.bots,
      provisioner,
      platform.crypto,
      platform.storage,
      config.workspaceId,
    ),
  )

  // Web UI pages
  app.route('/', createPages(platform.bots, config.platformBaseUrl))

  // Admin endpoints
  app.get('/admin/bots', async (c) => {
    const allBots = await platform.bots.findAllSummary()
    return c.json({ bots: allBots })
  })

  app.get('/admin/connections', (c) => {
    return c.json({
      connected: platform.relay.connectedBots(),
      count: platform.relay.connectedBots().length,
    })
  })

  // Config Token setup endpoint
  app.post('/admin/config-token', async (c) => {
    const body = await c.req.json<{
      workspaceId: string
      accessToken: string
      refreshToken: string
    }>()

    if (!body.workspaceId || !body.accessToken || !body.refreshToken) {
      return c.json(
        { error: 'workspaceId, accessToken, refreshToken required' },
        400,
      )
    }

    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000)

    await platform.configTokens.upsert({
      workspaceId: body.workspaceId,
      accessTokenEnc: await platform.vault.encrypt(body.accessToken),
      refreshTokenEnc: await platform.vault.encrypt(body.refreshToken),
      expiresAt,
    })

    return c.json({ ok: true, expiresAt: expiresAt.toISOString() })
  })

  return { app, provisioner }
}
