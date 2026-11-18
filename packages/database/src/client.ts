import { Database, SQLiteError } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database;
  close(): void;
}

/** Coordinate writers sharing the workspace directory, including across containers. */
export function acquireWorkspaceLock(directory: string): () => void {
  mkdirSync(directory, { recursive: true });
  // Keep the lock file in place so every writer opens the same inode.
  const lock = new Database(join(directory, ".structsmith-lock.sqlite"));
  try {
    lock.exec("BEGIN IMMEDIATE");
  } catch (error) {
    lock.close();
    if (error instanceof SQLiteError && error.code === "SQLITE_BUSY") {
      throw new Error(`Workspace directory is already in use: ${directory}`, { cause: error });
    }
    throw error;
  }
  return () => lock.close();
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
