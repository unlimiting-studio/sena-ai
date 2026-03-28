import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * SQLite schema for Cloudflare D1.
 * Equivalent to the MySQL schema in platform-node.
 */

export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  profileImageUrl: text('profile_image_url'),
  connectKey: text('connect_key').notNull().unique(),
  slackAppId: text('slack_app_id'),
  slackTeamId: text('slack_team_id'),
  botTokenEnc: text('bot_token_enc'),
  signingSecretEnc: text('signing_secret_enc'),
  clientId: text('client_id'),
  clientSecretEnc: text('client_secret_enc'),
  manifestJson: text('manifest_json'),
  status: text('status', { enum: ['pending', 'active', 'disabled'] })
    .notNull()
    .default('pending'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const configTokens = sqliteTable('config_tokens', {
  workspaceId: text('workspace_id').primaryKey(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const oauthStates = sqliteTable('oauth_states', {
  state: text('state').primaryKey(),
  botId: text('bot_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
})
