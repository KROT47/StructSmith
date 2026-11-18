import { expect, test } from "bun:test";
import { createDatabase, DrizzleStore } from "@structsmith/database";
import { createServices, InMemoryEventBus } from "@structsmith/domain";

test("each database starts with a fresh in-memory schema", () => {
  const first = createDatabase();
  const second = createDatabase();
  try {
    const services = createServices(new DrizzleStore(first.db), new InMemoryEventBus());
    services.workspaces.create({ name: "Client's portal — zażółć" });
    const isolated = createServices(new DrizzleStore(second.db), new InMemoryEventBus());
    expect(services.workspaces.list()).toHaveLength(1);
    expect(isolated.workspaces.list()).toEqual([]);
    expect(first.sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(
      first.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get(),
    ).toBeNull();
  } finally {
    first.close();
    second.close();
  }
});

test("generated schema enforces parent and view ownership with the original delete actions", () => {
  const database = createDatabase();
  try {
    const { sqlite } = database;
    expect(
      sqlite
        .query(
          "SELECT \"table\", on_delete FROM pragma_foreign_key_list('elements') WHERE \"from\" = 'parent_id'",
        )
        .get(),
    ).toEqual({
      table: "elements",
      on_delete: "CASCADE",
    });
    expect(
      sqlite
        .query(
          'SELECT "from", "table", on_delete FROM pragma_foreign_key_list(\'boundaries\') ORDER BY "from"',
        )
        .all(),
    ).toEqual([
      { from: "parent_boundary_id", table: "boundaries", on_delete: "SET NULL" },
      { from: "view_id", table: "views", on_delete: "CASCADE" },
      { from: "workspace_id", table: "workspaces", on_delete: "CASCADE" },
    ]);
    expect(
      sqlite
        .query(
          "SELECT name, \"desc\" FROM pragma_index_xinfo('idx_snapshots_workspace') WHERE key = 1 ORDER BY seqno",
        )
        .all(),
    ).toEqual([
      { name: "workspace_id", desc: 0 },
      { name: "created_at", desc: 1 },
    ]);
    expect(
      sqlite
        .query(
          "SELECT name, \"desc\" FROM pragma_index_xinfo('idx_activity_workspace') WHERE key = 1 ORDER BY seqno",
        )
        .all(),
    ).toEqual([
      { name: "workspace_id", desc: 0 },
      { name: "id", desc: 1 },
    ]);
  } finally {
    database.close();
  }
});
