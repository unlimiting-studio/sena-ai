import { defineConfig, env } from '@sena-ai/core'
import { claudeRuntime } from '@sena-ai/runtime-claude'
import { slackConnector } from '@sena-ai/connector-slack'
import { slackTools } from '@sena-ai/tools-slack'

export default defineConfig({
  name: '%%BOT_NAME%%',

  runtime: claudeRuntime({
    model: 'claude-sonnet-4-20250514',
  }),

  tools: [
    ...slackTools({ botToken: env('SLACK_BOT_TOKEN') }),
  ],

  connectors: [
    slackConnector({
      appId: env('SLACK_APP_ID'),
      botToken: env('SLACK_BOT_TOKEN'),
      signingSecret: env('SLACK_SIGNING_SECRET'),
    }),
  ],
})
