import { Hono } from 'hono'
import type { BotRepository } from '../types/repository.js'
import type { CryptoProvider } from '../types/crypto.js'
import type { Provisioner } from '../slack/provisioner.js'

/**
 * Web API endpoints for bot management.
 */
export function createWebApi(
  botRepo: BotRepository,
  provisioner: Provisioner,
  crypto: CryptoProvider,
  workspaceId: string,
) {
  const app = new Hono()

  // POST /api/bots - Create a new bot
  app.post('/api/bots', async (c) => {
    const body = await c.req.json<{ name: string }>()

    if (
      !body.name ||
      typeof body.name !== 'string' ||
      body.name.trim().length === 0
    ) {
      return c.json({ error: '봇 이름을 입력해주세요.' }, 400)
    }

    const botId = crypto.uuid()
    const connectKey = `cpk_${await crypto.randomHex(20)}`
    const name = body.name.trim()

    // Insert bot record
    await botRepo.create({
      id: botId,
      name,
      profileImageUrl: null,
      connectKey,
      slackAppId: null,
      slackTeamId: null,
      botTokenEnc: null,
      signingSecretEnc: null,
      clientId: null,
      clientSecretEnc: null,
      manifestJson: null,
      status: 'pending',
    })

    // Provision Slack app asynchronously
    provisionSlackApp(botId, name).catch((err: unknown) => {
      console.error(
        `[api] failed to provision Slack app for bot ${botId}:`,
        err,
      )
    })

    return c.json({ ok: true, botId, connectKey })
  })

  // GET /api/bots/:botId - Get bot status
  app.get('/api/bots/:botId', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)

    if (!bot) {
      return c.json({ error: 'bot not found' }, 404)
    }

    return c.json({
      bot: {
        id: bot.id,
        name: bot.name,
        profileImageUrl: bot.profileImageUrl,
        slackAppId: bot.slackAppId,
        slackTeamId: bot.slackTeamId,
        clientId: bot.clientId,
        status: bot.status,
        connectKey: bot.connectKey,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
      },
    })
  })

  async function provisionSlackApp(botId: string, botName: string) {
    const result = await provisioner.createApp(workspaceId, botId, botName)
    if (!result.ok) {
      console.error(
        `[provisioner] failed to create Slack app: ${result.error}`,
      )
    } else {
      console.log(
        `[provisioner] Slack app created for bot ${botId}: ${result.appId}`,
      )
    }
  }

  return app
}
