import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, lt } from 'drizzle-orm'
import type {
  BotRow,
  ConfigTokenRow,
  BotRepository,
  ConfigTokenRepository,
  OAuthStateRepository,
} from '../../types/repository.js'
import * as schema from './schema.js'

export type PostgreSQLDatabase = PostgresJsDatabase<typeof schema>

export function initPostgreSQLDb(databaseUrl: string): PostgreSQLDatabase {
  const client = postgres(databaseUrl)
  return drizzle(client, { schema })
}

function rowToBot(row: typeof schema.bots.$inferSelect): BotRow {
  return {
    id: row.id,
    name: row.name,
    botUsername: row.botUsername,
    profileImageUrl: row.profileImageUrl,
    connectKey: row.connectKey,
    slackAppId: row.slackAppId,
    slackTeamId: row.slackTeamId,
    botTokenEnc: row.botTokenEnc,
    signingSecretEnc: row.signingSecretEnc,
    clientId: row.clientId,
    clientSecretEnc: row.clientSecretEnc,
    manifestJson: row.manifestJson,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export interface PostgreSQLRepositories {
  bots: BotRepository
  configTokens: ConfigTokenRepository
  oauthStates: OAuthStateRepository
}

export function createPostgreSQLRepositories(
  db: PostgreSQLDatabase,
): PostgreSQLRepositories {
  return {
    bots: createBotRepository(db),
    configTokens: createConfigTokenRepository(db),
    oauthStates: createOAuthStateRepository(db),
  }
}

function createBotRepository(db: PostgreSQLDatabase): BotRepository {
  return {
    async findById(id) {
      const [row] = await db
        .select()
        .from(schema.bots)
        .where(eq(schema.bots.id, id))
        .limit(1)
      return row ? rowToBot(row) : null
    },

    async findByConnectKey(connectKey) {
      const [row] = await db
        .select()
        .from(schema.bots)
        .where(eq(schema.bots.connectKey, connectKey))
        .limit(1)
      return row ? rowToBot(row) : null
    },

    async findByConnectKeyAndStatus(connectKey, status) {
      const [row] = await db
        .select()
        .from(schema.bots)
        .where(
          and(
            eq(schema.bots.connectKey, connectKey),
            eq(schema.bots.status, status),
          ),
        )
        .limit(1)
      return row ? rowToBot(row) : null
    },

    async findByIdAndStatus(id, status) {
      const [row] = await db
        .select()
        .from(schema.bots)
        .where(
          and(eq(schema.bots.id, id), eq(schema.bots.status, status)),
        )
        .limit(1)
      return row ? rowToBot(row) : null
    },

    async findAll() {
      const rows = await db
        .select()
        .from(schema.bots)
        .orderBy(schema.bots.createdAt)
      return rows.map(rowToBot)
    },

    async findAllSummary() {
      const rows = await db
        .select({
          id: schema.bots.id,
          name: schema.bots.name,
          profileImageUrl: schema.bots.profileImageUrl,
          slackAppId: schema.bots.slackAppId,
          slackTeamId: schema.bots.slackTeamId,
          status: schema.bots.status,
          createdAt: schema.bots.createdAt,
        })
        .from(schema.bots)
        .orderBy(schema.bots.createdAt)
      return rows
    },

    async create(bot) {
      await db.insert(schema.bots).values({
        id: bot.id,
        name: bot.name,
        profileImageUrl: bot.profileImageUrl,
        connectKey: bot.connectKey,
        slackAppId: bot.slackAppId,
        slackTeamId: bot.slackTeamId,
        botTokenEnc: bot.botTokenEnc,
        signingSecretEnc: bot.signingSecretEnc,
        clientId: bot.clientId,
        clientSecretEnc: bot.clientSecretEnc,
        manifestJson: bot.manifestJson,
        status: bot.status,
      })
    },

    async update(id, data) {
      await db
        .update(schema.bots)
        .set(data)
        .where(eq(schema.bots.id, id))
    },

    async delete(id) {
      await db.delete(schema.bots).where(eq(schema.bots.id, id))
    },
  }
}

function createConfigTokenRepository(
  db: PostgreSQLDatabase,
): ConfigTokenRepository {
  return {
    async findByWorkspaceId(id) {
      const [row] = await db
        .select()
        .from(schema.configTokens)
        .where(eq(schema.configTokens.workspaceId, id))
        .limit(1)
      if (!row) return null
      return {
        workspaceId: row.workspaceId,
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
      }
    },

    async findAll() {
      const rows = await db.select().from(schema.configTokens)
      return rows.map(
        (row): ConfigTokenRow => ({
          workspaceId: row.workspaceId,
          accessTokenEnc: row.accessTokenEnc,
          refreshTokenEnc: row.refreshTokenEnc,
          expiresAt: row.expiresAt,
          updatedAt: row.updatedAt,
        }),
      )
    },

    async upsert(row) {
      await db
        .insert(schema.configTokens)
        .values({
          workspaceId: row.workspaceId,
          accessTokenEnc: row.accessTokenEnc,
          refreshTokenEnc: row.refreshTokenEnc,
          expiresAt: row.expiresAt,
        })
        .onConflictDoUpdate({
          target: schema.configTokens.workspaceId,
          set: {
            accessTokenEnc: row.accessTokenEnc,
            refreshTokenEnc: row.refreshTokenEnc,
            expiresAt: row.expiresAt,
          },
        })
    },
  }
}

function createOAuthStateRepository(
  db: PostgreSQLDatabase,
): OAuthStateRepository {
  return {
    async create(row) {
      await db.insert(schema.oauthStates).values({
        state: row.state,
        botId: row.botId,
        expiresAt: row.expiresAt,
      })
    },

    async consume(state) {
      const [row] = await db
        .select()
        .from(schema.oauthStates)
        .where(eq(schema.oauthStates.state, state))
        .limit(1)
      if (!row) return null

      // Check expiry
      if (row.expiresAt < new Date()) {
        await db
          .delete(schema.oauthStates)
          .where(eq(schema.oauthStates.state, state))
        return null
      }

      // Delete after consumption
      await db
        .delete(schema.oauthStates)
        .where(eq(schema.oauthStates.state, state))

      return {
        state: row.state,
        botId: row.botId,
        expiresAt: row.expiresAt,
      }
    },

    async deleteExpired() {
      await db
        .delete(schema.oauthStates)
        .where(lt(schema.oauthStates.expiresAt, new Date()))
    },
  }
}

// Re-export schema for drizzle-kit
export {
  TABLE_PREFIX,
  botStatusEnum,
  bots,
  configTokens,
  oauthStates,
} from './schema.js'
