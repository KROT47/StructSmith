import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createDatabase, DrizzleStore, runMigrations } from "@structsmith/database";
import { createServices, InMemoryEventBus } from "@structsmith/domain";
import { AutoExportScheduler } from "./auto-export";
import type { AppConfig } from "./config";
import { readWorkspaceDocuments, readWorkspaceFiles, writeWorkspaceFile } from "./workspace-files";

function recoverStaleLock(path: string, observed: string, pid: number): void {
  const recoveryPath = `${path}.recovery`;
  let descriptor: number;
  try {
    descriptor = openSync(recoveryPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(
      `Database lock recovery is already in progress. If no StructSmith process is running, remove ${recoveryPath} and retry.`,
    );
  }
  try {
    // Another recovering process may already have acquired a fresh owner lock.
    if (!existsSync(path) || readFileSync(path, "utf8") !== observed) return;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") rmSync(path);
    }
  } finally {
    closeSync(descriptor);
    rmSync(recoveryPath);
  }
}

/** A database has one owner; a second server must use its HTTP/MCP endpoint. */
function acquireDatabaseLock(databasePath: string): () => void {
  const path = `${databasePath}.lock`;
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  mkdirSync(dirname(databasePath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (existsSync(`${path}.recovery`)) {
      throw new Error(
        `Database lock recovery is already in progress. If no StructSmith process is running, remove ${path}.recovery and retry.`,
      );
    }
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try {
        writeFileSync(descriptor, owner);
      } finally {
        closeSync(descriptor);
      }
      return () => {
        if (existsSync(path) && readFileSync(path, "utf8") === owner) rmSync(path);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: unknown;
      let observed: string;
      try {
        observed = readFileSync(path, "utf8");
        pid = (JSON.parse(observed) as { pid?: unknown }).pid;
      } catch {
        throw new Error(`Database is already in use or has an unreadable owner lock: ${path}`);
      }
      if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
        throw new Error(`Database is already in use or has an invalid owner lock: ${path}`);
      }
      try {
        process.kill(pid, 0);
      } catch (ownerError) {
        if ((ownerError as NodeJS.ErrnoException).code === "ESRCH") {
          recoverStaleLock(path, observed, pid);
          continue;
        }
      }
      throw new Error(`Database is already in use by process ${pid}: ${databasePath}`);
    }
  }
  throw new Error(`Database is already in use: ${databasePath}`);
}

export function rebuildDatabase(config: AppConfig) {
  const directory = config.workspaceFilesDir ?? join(dirname(config.databasePath), "auto-exports");
  const release = acquireDatabaseLock(config.databasePath);
  const sourceMarker = `${config.databasePath}.json-source`;
  const initialized = existsSync(sourceMarker);
  const firstRun = !initialized && !existsSync(config.databasePath) && !existsSync(directory);
  const temporaryPath = `${config.databasePath}.rebuild-${randomUUID()}`;
  try {
    // Adopt existing installations once, before JSON becomes the source of truth.
    if (!initialized && !existsSync(directory) && existsSync(config.databasePath)) {
      const adoptionDirectory = join(
        dirname(directory),
        `.${basename(directory)}.adopt-${randomUUID()}`,
      );
      const previous = createDatabase(config.databasePath);
      try {
        runMigrations(previous.sqlite, config.migrationsDir);
        const services = createServices(new DrizzleStore(previous.db), new InMemoryEventBus());
        mkdirSync(adoptionDirectory, { recursive: true });
        const exports = new AutoExportScheduler(services, adoptionDirectory);
        try {
          exports.exportAll();
        } finally {
          exports.close();
        }
        renameSync(adoptionDirectory, directory);
      } finally {
        previous.close();
        rmSync(adoptionDirectory, { recursive: true, force: true });
      }
    }
    const files = readWorkspaceFiles(directory);
    const documents = readWorkspaceDocuments(directory);
    const candidate = createDatabase(temporaryPath);
    try {
      runMigrations(candidate.sqlite, config.migrationsDir);
      const services = createServices(new DrizzleStore(candidate.db), new InMemoryEventBus());
      try {
        services.imports.restoreDocuments(documents);
      } catch (error) {
        const workspaceId =
          error && typeof error === "object" && "workspaceId" in error
            ? error.workspaceId
            : undefined;
        const source = files.find(({ document }) => document.workspace.id === workspaceId);
        const paths = source?.path ?? files.map(({ path }) => path).join(", ");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot restore workspace JSON files [${paths}]: ${reason}`, {
          cause: error,
        });
      }
      candidate.sqlite.exec("PRAGMA journal_mode = DELETE;");
    } finally {
      candidate.close();
    }
    // No connection is open to the old database under this owner's lock.
    for (const suffix of ["-wal", "-shm", "-journal"])
      rmSync(`${config.databasePath}${suffix}`, { force: true });
    renameSync(temporaryPath, config.databasePath);
    mkdirSync(directory, { recursive: true });
    writeWorkspaceFile(sourceMarker, `${directory}\n`);
    const database = createDatabase(config.databasePath);
    return { database, directory, firstRun, release };
  } catch (error) {
    release();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not rebuild SQLite from JSON in ${directory}: ${reason}`, {
      cause: error,
    });
  } finally {
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      rmSync(`${temporaryPath}${suffix}`, { force: true });
  }
}
