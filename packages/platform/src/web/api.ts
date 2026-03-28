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
    const body = await c.req.json<{
      name: string
      botUsername: string
      profileImage?: string | null
    }>()

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
    const profileImageUrl =
      typeof body.profileImage === 'string' &&
      body.profileImage.startsWith('data:image/')
        ? body.profileImage
        : null

    // Insert bot record
    await botRepo.create({
      id: botId,
      name,
      botUsername,
      profileImageUrl,
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
    const provisionPromise = provisionSlackApp(
      botId,
      name,
      botUsername,
      profileImageUrl,
    ).catch((err: unknown) => {
      console.error(
        `[api] failed to provision Slack app for bot ${botId}:`,
        err,
      )
    })
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

  // DELETE /api/bots/:botId - Delete a bot and its Slack app
  app.delete('/api/bots/:botId', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)
    if (!bot) return c.json({ error: 'bot not found' }, 404)

    // Delete Slack app if it exists
    if (bot.slackAppId) {
      const result = await provisioner.deleteApp(workspaceId, bot.slackAppId)
      if (!result.ok) {
        console.error(`[api] failed to delete Slack app ${bot.slackAppId}: ${result.error}`)
        // Continue to delete from DB even if Slack deletion fails
      }
    }

    await botRepo.delete(botId)
    return c.json({ ok: true, deleted: botId })
  })

  // POST /api/bots/:botId/icon - Set bot app icon
  app.post('/api/bots/:botId/icon', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)
    if (!bot) return c.json({ error: 'bot not found' }, 404)
    if (!bot.slackAppId) {
      return c.json({ error: 'bot has no Slack app yet' }, 400)
    }

    const formData = await c.req.formData()
    const file = formData.get('image')
    if (!file || typeof file === 'string' || !('arrayBuffer' in file)) {
      return c.json({ error: 'image file is required' }, 400)
    }

    const imageBuffer = await (file as Blob).arrayBuffer()
    const result = await provisioner.setAppIcon(
      workspaceId,
      bot.slackAppId,
      imageBuffer,
    )

    if (result.ok) {
      // data URI로 저장하여 대시보드에서 표시
      const bytes = new Uint8Array(imageBuffer)
      let binaryStr = ''
      for (let i = 0; i < bytes.length; i++) {
        binaryStr += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binaryStr)
      const blob = file as Blob
      const mimeType = blob.type || 'image/png'
      await botRepo.update(botId, {
        profileImageUrl: `data:${mimeType};base64,${base64}`,
      })
    }

    return c.json(result, result.ok ? 200 : 502)
  })

  async function provisionSlackApp(
    botId: string,
    botName: string,
    botUsername: string,
    profileImageUrl?: string | null,
  ) {
    const result = await provisioner.createApp(
      workspaceId,
      botId,
      botName,
      botUsername,
    )
    if (!result.ok) {
      console.error(
        `[provisioner] failed to create Slack app: ${result.error}`,
      )
      return
    }

    console.log(
      `[provisioner] Slack app created for bot ${botId}: ${result.appId}`,
    )

    // 프로필 이미지가 있으면 앱 아이콘 설정
    if (
      profileImageUrl &&
      profileImageUrl.startsWith('data:image/') &&
      result.appId
    ) {
      try {
        const commaIndex = profileImageUrl.indexOf(',')
        if (commaIndex === -1) return
        const base64Data = profileImageUrl.substring(commaIndex + 1)
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const imageBuffer = bytes.buffer

        const iconResult = await provisioner.setAppIcon(
          workspaceId,
          result.appId,
          imageBuffer,
        )
        if (!iconResult.ok) {
          console.error(
            `[provisioner] failed to set app icon: ${iconResult.error}`,
          )
        } else {
          console.log(`[provisioner] app icon set for bot ${botId}`)
        }
      } catch (err: unknown) {
        console.error(`[provisioner] error setting app icon:`, err)
      }
    }
  }

  return app
}
