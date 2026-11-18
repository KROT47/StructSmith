import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database;
  close(): void;
}

const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function createDatabase(): DatabaseHandle {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("PRAGMA foreign_keys = ON;");
    sqlite.exec(schemaSql);
    const db = drizzle(sqlite, { schema });
    return { db, sqlite, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
