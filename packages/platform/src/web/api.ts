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
    const body = await c.req.json<{ name: string; botUsername: string }>()

    if (
      !body.name ||
      typeof body.name !== 'string' ||
      body.name.trim().length === 0
    ) {
      return c.json({ error: '봇 이름을 입력해주세요.' }, 400)
    }

    const botUsername = (body.botUsername ?? '').trim()
    if (
      !botUsername ||
      botUsername.length < 2 ||
      botUsername.length > 80 ||
      !/^[a-z0-9][a-z0-9-]*$/.test(botUsername)
    ) {
      return c.json(
        { error: '봇 유저네임은 영문 소문자, 숫자, 하이픈만 사용 가능하며 2-80자여야 합니다.' },
        400,
      )
    }

    const botId = crypto.uuid()
    const connectKey = `cpk_${await crypto.randomHex(20)}`
    const name = body.name.trim()

    // Insert bot record
    await botRepo.create({
      id: botId,
      name,
      botUsername,
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

    // Provision Slack app asynchronously (CF Workers needs waitUntil to keep alive)
    const provisionPromise = provisionSlackApp(botId, name, botUsername).catch(
      (err: unknown) => {
        console.error(
          `[api] failed to provision Slack app for bot ${botId}:`,
          err,
        )
      },
    )
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(provisionPromise)
    }

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

  // POST /api/bots/:botId/provision - Retry provisioning
  app.post('/api/bots/:botId/provision', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)
    if (!bot) return c.json({ error: 'bot not found' }, 404)
    if (bot.slackAppId) return c.json({ ok: true, appId: bot.slackAppId })

    const provisionPromise = provisionSlackApp(botId, bot.name, bot.botUsername).catch(
      (err: unknown) => {
        console.error(`[api] retry provision failed for ${botId}:`, err)
      },
    )
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(provisionPromise)
    }
    return c.json({ ok: true, message: 'provisioning started' })
  })

  async function provisionSlackApp(botId: string, botName: string, botUsername: string) {
    const result = await provisioner.createApp(workspaceId, botId, botName, botUsername)
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
