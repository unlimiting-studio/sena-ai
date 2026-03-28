import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import { eq, and, lt } from 'drizzle-orm'
import type {
  BotRow,
  ConfigTokenRow,
  BotRepository,
  ConfigTokenRepository,
  OAuthStateRepository,
} from '../../types/repository.js'
import * as schema from './schema.js'

export type D1Db = DrizzleD1Database<typeof schema>

export function initD1(d1: D1Database): D1Db {
  return drizzle(d1, { schema })
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

export interface D1Repositories {
  bots: BotRepository
  configTokens: ConfigTokenRepository
  oauthStates: OAuthStateRepository
}

export function createD1Repositories(db: D1Db): D1Repositories {
  return {
    bots: createD1BotRepository(db),
    configTokens: createD1ConfigTokenRepository(db),
    oauthStates: createD1OAuthStateRepository(db),
  }
}

function createD1BotRepository(db: D1Db): BotRepository {
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
        botUsername: bot.botUsername,
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
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.bots.id, id))
    },

    async delete(id) {
      await db.delete(schema.bots).where(eq(schema.bots.id, id))
    },
  }
}

function createD1ConfigTokenRepository(
  db: D1Db,
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
            updatedAt: new Date(),
          },
        })
    },
  }
}

function createD1OAuthStateRepository(
  db: D1Db,
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

      if (row.expiresAt < new Date()) {
        await db
          .delete(schema.oauthStates)
          .where(eq(schema.oauthStates.state, state))
        return null
      }

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

// Re-export schema for migrations
export { bots, configTokens, oauthStates } from './schema.js'
