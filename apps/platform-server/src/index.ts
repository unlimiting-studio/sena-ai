import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createApp } from '@sena-ai/platform'
import { createNodeRuntime } from '@sena-ai/platform/node'
import { initMySQLDb, createMySQLRepositories } from '@sena-ai/platform/db/mysql'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function main() {
  const PORT = parseInt(process.env.PORT || '3200', 10)
  const DATABASE_URL = requireEnv('DATABASE_URL')
  const VAULT_MASTER_KEY = requireEnv('VAULT_MASTER_KEY')
  const PLATFORM_BASE_URL =
    process.env.PLATFORM_BASE_URL || `http://localhost:${PORT}`
  const WORKSPACE_ID = process.env.SLACK_WORKSPACE_ID || 'default'
  // --- Create runtime (vault, relay, crypto) ---
  const runtime = createNodeRuntime({
    vaultMasterKey: VAULT_MASTER_KEY,
  })

  // --- Create DB repositories ---
  const db = await initMySQLDb(DATABASE_URL)
  const repos = createMySQLRepositories(db)

  // --- Compose platform ---
  const platform = { ...runtime, ...repos }

  // --- Create app ---
  const { app, provisioner } = createApp(platform, {
    platformBaseUrl: PLATFORM_BASE_URL,
    workspaceId: WORKSPACE_ID,
  })


  // --- Config Token rotation scheduler (10 hours) ---
  setInterval(
    async () => {
      const tokens = await repos.configTokens.findAll()

      for (const t of tokens) {
        try {
          await provisioner.rotateConfigToken(t.workspaceId)
          console.log(
            `[scheduler] rotated config token for ${t.workspaceId}`,
          )
        } catch (e) {
          console.error(
            `[scheduler] rotation failed for ${t.workspaceId}:`,
            e,
          )
        }
      }
    },
    10 * 60 * 60 * 1000, // 10 hours
  )

  // --- Start server ---
  console.log(`Sena Platform starting on port ${PORT}`)
  console.log(`  Base URL: ${PLATFORM_BASE_URL}`)

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`Listening on http://localhost:${info.port}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
