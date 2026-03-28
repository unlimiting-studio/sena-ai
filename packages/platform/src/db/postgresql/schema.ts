import {
  pgTableCreator,
  varchar,
  text,
  pgEnum,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Table prefix.
 * When set, all tables get a `{prefix}_` prefix.
 * E.g.: 'sena' -> sena_bots, sena_config_tokens
 */
export const TABLE_PREFIX = ''
const pgTable = pgTableCreator((name) =>
  TABLE_PREFIX ? `${TABLE_PREFIX}_${name}` : name,
)

export const botStatusEnum = pgEnum('bot_status', [
  'pending',
  'active',
  'disabled',
])

export const bots = pgTable(
  'bots',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    botUsername: varchar('bot_username', { length: 80 }).notNull().default(''),
    profileImageUrl: varchar('profile_image_url', { length: 512 }),
    connectKey: varchar('connect_key', { length: 255 }).notNull(),
    slackAppId: varchar('slack_app_id', { length: 64 }),
    slackTeamId: varchar('slack_team_id', { length: 64 }),
    botTokenEnc: text('bot_token_enc'),
    signingSecretEnc: text('signing_secret_enc'),
    clientId: varchar('client_id', { length: 128 }),
    clientSecretEnc: text('client_secret_enc'),
    manifestJson: text('manifest_json'),
    status: botStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp('updated_at', { mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [uniqueIndex('idx_bots_connect_key').on(table.connectKey)],
)

export const configTokens = pgTable('config_tokens', {
  workspaceId: varchar('workspace_id', { length: 64 }).primaryKey(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const oauthStates = pgTable('oauth_states', {
  state: varchar('state', { length: 64 }).primaryKey(),
  botId: varchar('bot_id', { length: 36 }).notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
})
