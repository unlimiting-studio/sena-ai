import { createApp, createProvisioner } from '@sena-ai/platform'
import { createCfRuntime, type CfEnv } from '@sena-ai/platform/cf'
import { initD1, createD1Repositories } from '@sena-ai/platform/db/d1'

export { RelayDurableObject } from './relay-do.js'

export interface Env extends CfEnv {
  DB: D1Database
  BOOTSTRAP_SCRIPT?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // --- Create runtime (vault, relay, crypto, storage) ---
    const runtime = await createCfRuntime(env)

    // --- Create DB repositories ---
    const db = initD1(env.DB)
    const repos = createD1Repositories(db)

    // --- Compose platform ---
    const platform = { ...runtime, ...repos }

    const { app } = createApp(platform, {
      platformBaseUrl: env.PLATFORM_BASE_URL,
      workspaceId: env.SLACK_WORKSPACE_ID,
      bootstrapScript: env.BOOTSTRAP_SCRIPT,
    })

    // Serve R2 uploads for /uploads/* paths
    const url = new URL(request.url)
    if (url.pathname.startsWith('/uploads/')) {
      const key = url.pathname.slice(1) // "uploads/filename"
      const obj = await env.UPLOADS.get(key)
      if (!obj) {
        return new Response('not found', { status: 404 })
      }
      const headers = new Headers()
      const ct = obj.httpMetadata?.contentType
      if (ct) {
        headers.set('Content-Type', ct)
      }
      headers.set('Cache-Control', 'public, max-age=86400')
      return new Response(obj.body, { headers })
    }

    return app.fetch(request)
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
