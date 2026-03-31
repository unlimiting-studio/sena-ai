import { Hono } from 'hono'
import { logger } from 'hono/logger'
import type { Platform, AppConfig } from './types/platform.js'
import { createApiProxy } from './relay/api-proxy.js'
import { createSlackEventsHandler } from './slack/events.js'
import { createOAuthHandler } from './slack/oauth.js'
import { createProvisioner, type Provisioner } from './slack/provisioner.js'
import { createAuthHandler, createAuthMiddleware } from './auth/handler.js'
import { createWebApi } from './web/api.js'
import { createPages } from './web/pages.js'
import { createSetupPage } from './web/setup.js'

export interface CreateAppResult {
  app: Hono
  provisioner: Provisioner
}

/**
 * Create the main Hono application with all routes wired up.
 * Works in both Node.js and CF Workers environments.
 */
function generateInstallScript(): string {
  return `#!/bin/sh
set -e

# sena-ai bot bootstrap script
# Usage: curl -fsSL <platform-url>/install.sh | sh -s -- --name "봇이름" --bot-username "lily-bot" --connect-key "cpk_..." --platform-url "https://..."

BOT_NAME=""
BOT_USERNAME=""
CONNECT_KEY=""
PLATFORM_URL=""

while [ \$# -gt 0 ]; do
  case "\$1" in
    --name) BOT_NAME="\$2"; shift 2;;
    --bot-username) BOT_USERNAME="\$2"; shift 2;;
    --connect-key) CONNECT_KEY="\$2"; shift 2;;
    --platform-url) PLATFORM_URL="\$2"; shift 2;;
    *) echo "Unknown option: \$1"; exit 1;;
  esac
done

if [ -z "\$BOT_NAME" ] || [ -z "\$BOT_USERNAME" ] || [ -z "\$CONNECT_KEY" ] || [ -z "\$PLATFORM_URL" ]; then
  echo "Error: --name, --bot-username, --connect-key, --platform-url are all required."
  exit 1
fi

DIR_NAME="\$BOT_USERNAME"

echo "🤖 Setting up bot: \$BOT_NAME"
echo "   Directory: ./\$DIR_NAME"
echo ""

# Download template from GitHub
echo "📦 Downloading bot template..."
TMPDIR_DL=\$(mktemp -d)
curl -fsSL https://github.com/unlimiting-studio/sena-ai/archive/refs/heads/main.tar.gz -o "\$TMPDIR_DL/repo.tar.gz"
tar xzf "\$TMPDIR_DL/repo.tar.gz" -C "\$TMPDIR_DL"

# Copy template directory
cp -r "\$TMPDIR_DL/sena-ai-main/templates/bot-starter" "\$DIR_NAME"
rm -rf "\$TMPDIR_DL"

cd "\$DIR_NAME"

# Escape special characters for sed replacement
escape_sed() {
  printf '%s' "\$1" | sed 's/[&/\\]/\\&/g'
}

# Customize package.json name
ESCAPED_DIR=\$(escape_sed "\$DIR_NAME")
sed -i.bak "s/\\"sena-bot\\"/\\"\$ESCAPED_DIR\\"/" package.json && rm -f package.json.bak

# Replace bot name placeholder in sena.config.ts
ESCAPED_NAME=\$(escape_sed "\$BOT_NAME")
sed -i.bak "s/%%BOT_NAME%%/\$ESCAPED_NAME/" sena.config.ts && rm -f sena.config.ts.bak

# Create .env from template
ESCAPED_KEY=\$(escape_sed "\$CONNECT_KEY")
sed -e "s/%%CONNECT_KEY%%/\$ESCAPED_KEY/" -e "s|%%PLATFORM_URL%%|\$PLATFORM_URL|" .env.template > .env
rm -f .env.template

echo ""
echo "✅ Bot scaffolding complete!"
echo ""
echo "Next steps:"
echo "  cd \$DIR_NAME"
echo "  pnpm install"
echo "  npx sena start"
echo ""
`
}

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

  const authMiddleware = createAuthMiddleware(
    platform.workspaceAdminConfig,
    platform.vault,
  )

  // Serve bootstrap script at /install.sh
  app.get('/install.sh', (c) => {
    c.header('Content-Type', 'text/plain; charset=utf-8')
    return c.body(generateInstallScript())
  })

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

  // Bot installation OAuth
  app.route(
    '/',
    createOAuthHandler(
      platform.bots,
      platform.vault,
      platform.crypto,
      platform.oauthStates,
    ),
  )

  // Slack login setup + auth
  app.route('/', createSetupPage(platform.workspaceAdminConfig, platform.vault))
  app.route(
    '/',
    createAuthHandler(
      platform.workspaceAdminConfig,
      platform.oauthStates,
      platform.crypto,
      platform.vault,
      { platformBaseUrl: config.platformBaseUrl },
    ),
  )

  // Protect all subsequent web/API/admin routes.
  app.use('/', authMiddleware.requireAuth)
  app.use('/bots/*', authMiddleware.requireAuth)
  app.use('/api/*', authMiddleware.requireAuth)
  app.use('/admin/*', authMiddleware.requireAuth)

  // Web API
  app.route(
    '/',
    createWebApi(
      platform.bots,
      provisioner,
      platform.crypto,
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

  return { app, provisioner }
}
