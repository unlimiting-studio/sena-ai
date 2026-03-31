import {
  mysqlTableCreator,
  varchar,
  text,
  mysqlEnum,
  datetime,
  uniqueIndex,
} from 'drizzle-orm/mysql-core'

/**
 * Table prefix.
 * When set, all tables get a `{prefix}_` prefix.
 * E.g.: 'sena' -> sena_bots, sena_config_tokens
 */
export const TABLE_PREFIX = ''
const mysqlTable = mysqlTableCreator((name) =>
  TABLE_PREFIX ? `${TABLE_PREFIX}_${name}` : name,
)

export const bots = mysqlTable(
  'bots',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    botUsername: varchar('bot_username', { length: 80 }).notNull().default(''),
    profileImageUrl: text('profile_image_url'),
    connectKey: varchar('connect_key', { length: 255 }).notNull(),
    slackAppId: varchar('slack_app_id', { length: 64 }),
    slackTeamId: varchar('slack_team_id', { length: 64 }),
    botTokenEnc: text('bot_token_enc'),
    signingSecretEnc: text('signing_secret_enc'),
    clientId: varchar('client_id', { length: 128 }),
    clientSecretEnc: text('client_secret_enc'),
    manifestJson: text('manifest_json'),
    status: mysqlEnum('status', ['pending', 'active', 'disabled'])
      .notNull()
      .default('pending'),
    createdAt: datetime('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: datetime('updated_at')
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [uniqueIndex('idx_bots_connect_key').on(table.connectKey)],
)

export const configTokens = mysqlTable('config_tokens', {
  workspaceId: varchar('workspace_id', { length: 64 }).primaryKey(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  expiresAt: datetime('expires_at').notNull(),
  updatedAt: datetime('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
})

export const oauthStates = mysqlTable('oauth_states', {
  state: varchar('state', { length: 64 }).primaryKey(),
  botId: varchar('bot_id', { length: 36 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
})

export const workspaceAdminConfig = mysqlTable('workspace_admin_config', {
  workspaceId: varchar('workspace_id', { length: 64 }).primaryKey(),
  slackClientId: varchar('slack_client_id', { length: 128 }),
  slackClientSecretEnc: text('slack_client_secret_enc'),
  dCookieEnc: text('d_cookie_enc'),
  xoxcTokenEnc: text('xoxc_token_enc'),
  workspaceDomain: varchar('workspace_domain', { length: 255 }),
  updatedAt: datetime('updated_at')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
  updatedByUserId: varchar('updated_by_user_id', { length: 36 }),
})
