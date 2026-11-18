import { createDatabase, type DatabaseHandle, DrizzleStore } from "@structsmith/database";
import { createServices, InMemoryEventBus, type Services } from "@structsmith/domain";
import { AutoExportScheduler } from "./auto-export";
import type { AppConfig } from "./config";
import {
  normalizeWorkspaceFiles,
  readWorkspaceFiles,
  uniqueWorkspaceFiles,
} from "./workspace-files";
import { acquireWorkspaceLock } from "./workspace-lock";

export interface AppContext {
  config: AppConfig;
  database: DatabaseHandle;
  services: Services;
  bus: InMemoryEventBus;
}

export function createAppContext(config: AppConfig): AppContext {
  const directory = config.workspaceFilesDir;
  const release = acquireWorkspaceLock(directory);
  let database: DatabaseHandle | undefined;
  try {
    const files = readWorkspaceFiles(directory);
    const sources = uniqueWorkspaceFiles(files);
    database = createDatabase();
    const bus = new InMemoryEventBus();
    const services = createServices(new DrizzleStore(database.db), bus);

    try {
      services.imports.restoreDocuments(sources.map(({ document }) => document));
    } catch (error) {
      const workspaceId =
        error && typeof error === "object" && "workspaceId" in error
          ? error.workspaceId
          : undefined;
      const source = sources.find(({ document }) => document.workspace.id === workspaceId);
      const paths = source?.path ?? sources.map(({ path }) => path).join(", ");
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot restore workspace JSON [${paths}]: ${reason}`, { cause: error });
    }
    const autoExports = new AutoExportScheduler(
      services,
      directory,
      normalizeWorkspaceFiles(files),
    );
    const closeDatabase = database.close;
    let closed = false;
    database.close = () => {
      if (closed) return;
      closed = true;
      try {
        autoExports.close();
      } finally {
        try {
          closeDatabase();
        } finally {
          release();
        }
      }
    };
    return { config, database, services, bus };
  } catch (error) {
    try {
      database?.close();
    } finally {
      release();
    }
    throw error;
  }
}
