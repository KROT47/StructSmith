import { createDatabase, DrizzleStore } from "@structsmith/database";
import { createServices, InMemoryEventBus, type Services } from "@structsmith/domain";

export interface TestContext {
  services: Services;
  bus: InMemoryEventBus;
  close: () => void;
}

/** Every test gets its own in-memory database with the production schema. */
export function createTestContext(): TestContext {
  const database = createDatabase();

  const bus = new InMemoryEventBus();
  const services = createServices(new DrizzleStore(database.db), bus);

  return { services, bus, close: () => database.close() };
}

export function createWorkspace(services: Services, name = "Test") {
  return services.workspaces.create({ name, mode: "relaxed" });
}
