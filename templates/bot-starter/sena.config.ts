import { defineConfig, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { platformConnector } from '@sena-ai/platform-connector'

export default defineConfig({
  name: '%%BOT_NAME%%',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-20250514',
  }),

  connectors: [
    platformConnector({
      platformUrl: env('PLATFORM_URL'),
      connectKey: env('CONNECT_KEY'),
    }),
  ],
})
