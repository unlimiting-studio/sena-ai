import { sql } from "drizzle-orm";
import { bigint, datetime, mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { encrypted } from "./customTypes.ts";

const TABLE_PREFIX = "v2_";

export const githubCredentials = mysqlTable(`${TABLE_PREFIX}github_credentials`, {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  user_id: varchar("user_id", { length: 30 }),
  slack_user_id: varchar("slack_user_id", { length: 30 }),
  access_token: encrypted("access_token"),
  refresh_token: encrypted("refresh_token"),
  token_expires_at: datetime("token_expires_at", { fsp: 6 }),
  created_at: datetime("created_at", { fsp: 6 }).default(sql`CURRENT_TIMESTAMP(6)`).notNull(),
  updated_at: datetime("updated_at", { fsp: 6 })
    .default(sql`(CURRENT_TIMESTAMP(6))`)
    .$onUpdate(() => new Date())
    .notNull(),
});

export const slackCredentials = mysqlTable(`${TABLE_PREFIX}slack_credentials`, {
  id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
  user_id: varchar("user_id", { length: 30 }).notNull(),
  slack_user_id: varchar("slack_user_id", { length: 30 }).notNull(),
  access_token: encrypted("access_token"),
  refresh_token: encrypted("refresh_token"),
  token_expires_at: datetime("token_expires_at", { fsp: 6 }),
  created_at: datetime("created_at", { fsp: 6 }).default(sql`CURRENT_TIMESTAMP(6)`).notNull(),
  updated_at: datetime("updated_at", { fsp: 6 })
    .default(sql`(CURRENT_TIMESTAMP(6))`)
    .$onUpdate(() => new Date())
    .notNull(),
});
