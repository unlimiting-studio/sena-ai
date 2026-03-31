import type { Vault } from '../types/vault.js'
import type {
  BotRepository,
  ConfigTokenRepository,
} from '../types/repository.js'

const SLACK_MANIFEST_TEMPLATE = (opts: {
  botName: string
  botUsername: string
  eventUrl: string
  redirectUrl: string
}) => ({
  display_information: {
    name: opts.botName,
    description: `${opts.botName} -- powered by sena-ai`,
    background_color: '#1a1a2e',
  },
  features: {
    bot_user: {
      display_name: opts.botUsername,
      always_online: true,
    },
  },
  oauth_config: {
    redirect_urls: [opts.redirectUrl],
    scopes: {
      bot: [
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
      ],
    },
  },
  settings: {
    event_subscriptions: {
      request_url: opts.eventUrl,
      bot_events: [
        'app_mention',
        'message.channels',
        'message.groups',
        'message.im',
        'reaction_added',
      ],
    },
    interactivity: {
      is_enabled: false,
    },
    org_deploy_enabled: false,
    socket_mode_enabled: false,
  },
})

type ManifestCreateResponse = {
  ok: boolean
  app_id?: string
  credentials?: {
    client_id?: string
    client_secret?: string
    signing_secret?: string
  }
  error?: string
}

type TokenRotateResponse = {
  ok: boolean
  token?: string
  refresh_token?: string
  exp?: number
  error?: string
}

export interface Provisioner {
  rotateConfigToken(workspaceId: string): Promise<boolean>
  createApp(
    workspaceId: string,
    botId: string,
    botName: string,
    botUsername: string,
  ): Promise<{
    ok: boolean
    appId?: string
    clientId?: string
    clientSecret?: string
    signingSecret?: string
    error?: string
  }>
  deleteApp(
    workspaceId: string,
    appId: string,
  ): Promise<{ ok: boolean; error?: string }>
  SLACK_MANIFEST_TEMPLATE: typeof SLACK_MANIFEST_TEMPLATE
}

/**
 * Slack App Configuration Token management.
 * One Config Token per workspace manages multiple apps.
 */
export function createProvisioner(
  botRepo: BotRepository,
  configTokenRepo: ConfigTokenRepository,
  vault: Vault,
  platformBaseUrl: string,
): Provisioner {
  async function rotateConfigToken(workspaceId: string): Promise<boolean> {
    const row = await configTokenRepo.findByWorkspaceId(workspaceId)
    if (!row) return false

    const refreshToken = await vault.decrypt(row.refreshTokenEnc)

    const res = await fetch('https://slack.com/api/tooling.tokens.rotate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ refresh_token: refreshToken }),
    })

    const data = (await res.json()) as TokenRotateResponse

    if (!data.ok || !data.token || !data.refresh_token) {
      console.error(
        `[provisioner] rotate failed for ${workspaceId}:`,
        data.error,
      )
      return false
    }

    await configTokenRepo.upsert({
      workspaceId,
      accessTokenEnc: await vault.encrypt(data.token),
      refreshTokenEnc: await vault.encrypt(data.refresh_token),
      expiresAt: new Date((data.exp ?? 0) * 1000),
    })

    return true
  }

  async function createApp(
    workspaceId: string,
    botId: string,
    botName: string,
    botUsername: string,
  ): Promise<{
    ok: boolean
    appId?: string
    clientId?: string
    clientSecret?: string
    signingSecret?: string
    error?: string
  }> {
    const tokenRow = await configTokenRepo.findByWorkspaceId(workspaceId)
    if (!tokenRow) {
      return { ok: false, error: 'no config token for workspace' }
    }

    const configToken = await vault.decrypt(tokenRow.accessTokenEnc)
    const eventUrl = `${platformBaseUrl}/slack/events/${botId}`
    const redirectUrl = `${platformBaseUrl}/oauth/callback`
    const manifest = SLACK_MANIFEST_TEMPLATE({
      botName,
      botUsername,
      eventUrl,
      redirectUrl,
    })

    const res = await fetch('https://slack.com/api/apps.manifest.create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ manifest }),
    })

    const data = (await res.json()) as ManifestCreateResponse

    if (!data.ok) {
      console.error(
        `[provisioner] Slack API error detail:`,
        JSON.stringify(data),
      )
      return { ok: false, error: data.error }
    }

    await botRepo.update(botId, {
      slackAppId: data.app_id ?? null,
      clientId: data.credentials?.client_id ?? null,
      clientSecretEnc: data.credentials?.client_secret
        ? await vault.encrypt(data.credentials.client_secret)
        : null,
      signingSecretEnc: data.credentials?.signing_secret
        ? await vault.encrypt(data.credentials.signing_secret)
        : null,
      manifestJson: JSON.stringify(manifest),
    })

    return {
      ok: true,
      appId: data.app_id,
      clientId: data.credentials?.client_id,
      clientSecret: data.credentials?.client_secret,
      signingSecret: data.credentials?.signing_secret,
    }
  }

  async function deleteApp(
    workspaceId: string,
    appId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const tokenRow = await configTokenRepo.findByWorkspaceId(workspaceId)
    if (!tokenRow) {
      return { ok: false, error: 'no config token for workspace' }
    }

    const configToken = await vault.decrypt(tokenRow.accessTokenEnc)

    const res = await fetch('https://slack.com/api/apps.manifest.delete', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${configToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_id: appId }),
    })

    const data = (await res.json()) as { ok: boolean; error?: string }

    if (!data.ok) {
      console.error(
        `[provisioner] Slack app delete failed for ${appId}:`,
        JSON.stringify(data),
      )
      return { ok: false, error: data.error }
    }

    return { ok: true }
  }

  return {
    rotateConfigToken,
    createApp,
    deleteApp,
    SLACK_MANIFEST_TEMPLATE,
  }
}
