import { createApp, createProvisioner } from '@sena-ai/platform'
import { createCfRuntime, type CfEnv } from '@sena-ai/platform/cf'
import { initD1, createD1Repositories } from '@sena-ai/platform/db/d1'

export { RelayDurableObject } from './relay-do.js'

export interface Env extends CfEnv {
  DB: D1Database
  BOOTSTRAP_SCRIPT?: string
  SLACK_CONFIG_TOKEN?: string
  SLACK_CONFIG_REFRESH_TOKEN?: string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // --- Create runtime (vault, relay, crypto) ---
    const runtime = await createCfRuntime(env)

    // --- Create DB repositories ---
    const db = initD1(env.DB)
    const repos = createD1Repositories(db)

    // --- Compose platform ---
    const platform = { ...runtime, ...repos }

    // Bootstrap config token from env vars if DB is empty
    if (env.SLACK_CONFIG_TOKEN && env.SLACK_CONFIG_REFRESH_TOKEN) {
      const existing = await repos.configTokens.findByWorkspaceId(env.SLACK_WORKSPACE_ID)
      if (!existing) {
        await repos.configTokens.upsert({
          workspaceId: env.SLACK_WORKSPACE_ID,
          accessTokenEnc: await runtime.vault.encrypt(env.SLACK_CONFIG_TOKEN),
          refreshTokenEnc: await runtime.vault.encrypt(env.SLACK_CONFIG_REFRESH_TOKEN),
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
        console.log('[bootstrap] config token seeded from env vars')
      }
    }

    const { app } = createApp(platform, {
      platformBaseUrl: env.PLATFORM_BASE_URL,
      workspaceId: env.SLACK_WORKSPACE_ID,
      bootstrapScript: env.BOOTSTRAP_SCRIPT,
    })

    return app.fetch(request, env, ctx)
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
  ): Promise<void> {
    const runtime = await createCfRuntime(env)
    const db = initD1(env.DB)
    const repos = createD1Repositories(db)

    const provisioner = createProvisioner(
      repos.bots,
      repos.configTokens,
      runtime.vault,
      env.PLATFORM_BASE_URL,
    )

    const tokens = await repos.configTokens.findAll()

    for (const t of tokens) {
      try {
        await provisioner.rotateConfigToken(t.workspaceId)
        console.log(`[scheduled] rotated config token for ${t.workspaceId}`)
      } catch (e) {
        console.error(
          `[scheduled] rotation failed for ${t.workspaceId}:`,
          e,
        )
      }
    }
  },
}
