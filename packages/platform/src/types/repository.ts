/**
 * Database row types and repository interfaces.
 * These abstract away the underlying DB (MySQL, PostgreSQL, D1/SQLite) and ORM (Drizzle).
 */

export interface BotRow {
  id: string
  name: string
  botUsername: string
  profileImageUrl: string | null
  connectKey: string
  slackAppId: string | null
  slackTeamId: string | null
  botTokenEnc: string | null
  signingSecretEnc: string | null
  clientId: string | null
  clientSecretEnc: string | null
  manifestJson: string | null
  status: 'pending' | 'active' | 'disabled'
  createdAt: Date
  updatedAt: Date
}

export interface ConfigTokenRow {
  workspaceId: string
  accessTokenEnc: string
  refreshTokenEnc: string
  expiresAt: Date
  updatedAt: Date
}

export interface OAuthStateRow {
  state: string
  botId: string
  expiresAt: Date
}

export interface BotRepository {
  findById(id: string): Promise<BotRow | null>
  findByConnectKey(connectKey: string): Promise<BotRow | null>
  findByConnectKeyAndStatus(
    connectKey: string,
    status: BotRow['status'],
  ): Promise<BotRow | null>
  findByIdAndStatus(
    id: string,
    status: BotRow['status'],
  ): Promise<BotRow | null>
  findAll(): Promise<BotRow[]>
  findAllSummary(): Promise<
    Array<{
      id: string
      name: string
      profileImageUrl: string | null
      slackAppId: string | null
      slackTeamId: string | null
      status: BotRow['status']
      createdAt: Date
    }>
  >
  create(bot: Omit<BotRow, 'createdAt' | 'updatedAt'>): Promise<void>
  update(id: string, data: Partial<Omit<BotRow, 'id'>>): Promise<void>
}

export interface ConfigTokenRepository {
  findByWorkspaceId(id: string): Promise<ConfigTokenRow | null>
  findAll(): Promise<ConfigTokenRow[]>
  upsert(row: Omit<ConfigTokenRow, 'updatedAt'>): Promise<void>
}

export interface OAuthStateRepository {
  create(row: OAuthStateRow): Promise<void>
  consume(state: string): Promise<OAuthStateRow | null>
  deleteExpired(): Promise<void>
}
