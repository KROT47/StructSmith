import {
  createDatabase,
  type DatabaseHandle,
  DrizzleStore,
  runMigrations,
} from "@structsmith/database";
import { createServices, InMemoryEventBus, type Services } from "@structsmith/domain";
import { AutoExportScheduler } from "./auto-export";
import type { AppConfig } from "./config";
import { seedExampleWorkspace } from "./seed";
import { rebuildDatabase } from "./startup-rebuild";

export interface AppContext {
  config: AppConfig;
  database: DatabaseHandle;
  services: Services;
  bus: InMemoryEventBus;
}

export function createAppContext(config: AppConfig): AppContext {
  const restored = config.databasePath === ":memory:" ? null : rebuildDatabase(config);
  const database = restored?.database ?? createDatabase(":memory:");
  let autoExports: AutoExportScheduler | undefined;
  try {
    if (!restored) runMigrations(database.sqlite, config.migrationsDir);
    const bus = new InMemoryEventBus();
    const services = createServices(new DrizzleStore(database.db), bus);

    // Restoration happens before export listeners, API clients and MCP can write.
    if (config.seedExample && (!restored || restored.firstRun)) seedExampleWorkspace(services);
    if (restored) {
      autoExports = new AutoExportScheduler(services, restored.directory);
      if (restored.firstRun) autoExports.exportAll();
    }
    const closeDatabase = database.close;
    let closed = false;
    database.close = () => {
      if (closed) return;
      closed = true;
      try {
        autoExports?.close();
      } finally {
        try {
          closeDatabase();
        } finally {
          restored?.release();
        }
      }
    };
    return { config, database, services, bus };
  } catch (error) {
    database.close();
    restored?.release();
    throw error;
  }
}
