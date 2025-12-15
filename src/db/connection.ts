import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import * as mysql from "mysql2/promise";
import { CONFIG } from "../config.ts";
import * as schema from "./schema.ts";

let pool: mysql.Pool | null = null;
let db: MySql2Database<typeof schema> | null = null;

export async function getDB(): Promise<MySql2Database<typeof schema>> {
  if (db) {
    return db;
  }

  pool = await mysql.createPool({
    uri: CONFIG.DATABASE_URL,
    connectionLimit: 10,
  });

  db = drizzle(pool, { schema, mode: "default" });
  return db;
}

export async function closeDB(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
  pool = null;
  db = null;
}
