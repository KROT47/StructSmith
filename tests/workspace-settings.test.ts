import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  WorkspaceDocumentSchema,
} from "@structsmith/contracts";
import { createDatabase, DrizzleStore, runMigrations } from "@structsmith/database";
import { createServices, type DomainEvent, InMemoryEventBus } from "@structsmith/domain";
import { createTestContext } from "./helpers";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

describe("workspace settings", () => {
  test("new workspaces disable automatic export by default", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Default" });
      expect(workspace.settings).toEqual({ automaticExport: "disabled" });
      expect(services.workspaces.get(workspace.id).settings).toEqual({
        automaticExport: "disabled",
      });
    } finally {
      close();
    }
  });

  test("automatic export settings survive reopening SQLite", () => {
    const directory = mkdtempSync(join(tmpdir(), "structsmith-workspace-settings-"));
    const databasePath = join(directory, "test.db");
    try {
      const database = createDatabase(databasePath);
      let workspaceId: string;
      try {
        runMigrations(database.sqlite, migrationsDir);
        const services = createServices(new DrizzleStore(database.db), new InMemoryEventBus());
        workspaceId = services.workspaces.create({
          name: "Persistent",
          settings: { automaticExport: "json" },
        }).id;
        expect(services.workspaces.get(workspaceId).settings).toEqual({ automaticExport: "json" });
        services.workspaces.update(workspaceId, { settings: { automaticExport: "mermaid" } });
      } finally {
        database.close();
      }
      const reopened = createDatabase(databasePath);
      try {
        expect(runMigrations(reopened.sqlite, migrationsDir).applied).toEqual([]);
        const services = createServices(new DrizzleStore(reopened.db), new InMemoryEventBus());
        expect(services.workspaces.get(workspaceId).settings).toEqual({
          automaticExport: "mermaid",
        });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("REST payload schemas reject unsupported automatic export formats", () => {
    for (const automaticExport of ["disabled", "json", "mermaid"] as const) {
      expect(
        CreateWorkspaceSchema.parse({ name: "Valid", settings: { automaticExport } }).settings,
      ).toEqual({ automaticExport });
      expect(UpdateWorkspaceSchema.parse({ settings: { automaticExport } }).settings).toEqual({
        automaticExport,
      });
    }
    expect(
      CreateWorkspaceSchema.safeParse({ name: "Invalid", settings: { automaticExport: "yaml" } })
        .success,
    ).toBe(false);
    expect(UpdateWorkspaceSchema.safeParse({ settings: { automaticExport: "yaml" } }).success).toBe(
      false,
    );
  });

  test("settings and metadata patches preserve every omitted field", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({
        name: "Unchanged",
        mode: "strict",
        description: "Description",
      });
      const updated = services.workspaces.update(
        workspace.id,
        UpdateWorkspaceSchema.parse({ settings: { automaticExport: "json" } }),
      );
      expect(updated.result).toMatchObject({
        name: "Unchanged",
        mode: "strict",
        description: "Description",
        settings: { automaticExport: "json" },
        revision: updated.revision,
      });
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ settings: {} }));
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ name: "Renamed" }));
      expect(services.workspaces.get(workspace.id)).toMatchObject({
        name: "Renamed",
        mode: "strict",
        description: "Description",
        settings: { automaticExport: "json" },
      });
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ mode: "relaxed" }));
      expect(services.workspaces.get(workspace.id)).toMatchObject({
        name: "Renamed",
        mode: "relaxed",
        settings: { automaticExport: "json" },
      });
    } finally {
      close();
    }
  });

  test("each successful settings save emits its committed revision even for the same format", () => {
    const { services, bus, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Settings events" });
      const events: DomainEvent[] = [];
      const observed: { revision: number; automaticExport: string }[] = [];
      bus.subscribe((event) => {
        events.push(event);
        if (event.type === "workspace.settings.changed") {
          const saved = services.workspaces.get(event.workspaceId);
          observed.push({
            revision: saved.revision,
            automaticExport: saved.settings.automaticExport,
          });
        }
      });
      services.workspaces.update(
        workspace.id,
        { settings: { automaticExport: "json" } },
        { source: "mcp", expectedRevision: 1 },
      );
      services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
      services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
      expect(events.filter((event) => event.type === "workspace.settings.changed")).toEqual([
        {
          type: "workspace.settings.changed",
          workspaceId: workspace.id,
          revision: 2,
          source: "mcp",
        },
        {
          type: "workspace.settings.changed",
          workspaceId: workspace.id,
          revision: 3,
          source: "ui",
        },
        {
          type: "workspace.settings.changed",
          workspaceId: workspace.id,
          revision: 4,
          source: "ui",
        },
      ]);
      expect(observed).toEqual([
        { revision: 2, automaticExport: "json" },
        { revision: 3, automaticExport: "json" },
        { revision: 4, automaticExport: "disabled" },
      ]);
      expect(events.filter((event) => event.type === "workspace.changed")).toHaveLength(3);
    } finally {
      close();
    }
  });

  test("metadata patches and rejected settings saves do not emit settings events", () => {
    const { services, bus, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Settings events" });
      const events: DomainEvent[] = [];
      bus.subscribe((event) => events.push(event));
      services.workspaces.update(workspace.id, { name: "Renamed", mode: "strict" });
      expect(() =>
        services.workspaces.update(
          workspace.id,
          { settings: { automaticExport: "json" } },
          { expectedRevision: 1 },
        ),
      ).toThrow("modified by someone else");
      expect(events.filter((event) => event.type === "workspace.settings.changed")).toEqual([]);
      expect(events.filter((event) => event.type === "workspace.changed")).toHaveLength(1);
      expect(services.workspaces.get(workspace.id)).toMatchObject({
        name: "Renamed",
        mode: "strict",
        revision: 2,
        settings: { automaticExport: "disabled" },
      });
    } finally {
      close();
    }
  });

  test("old JSON documents import with automatic export disabled", () => {
    const { services, close } = createTestContext();
    try {
      const document = WorkspaceDocumentSchema.parse({
        formatVersion: 1,
        workspace: {
          id: "legacy",
          name: "Legacy",
          description: null,
          mode: "relaxed",
          revision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        elements: [],
        relationships: [],
        views: [],
        records: [],
      });
      const imported = services.imports.importDocument(document);
      expect(imported.settings).toEqual({ automaticExport: "disabled" });
    } finally {
      close();
    }
  });

  test("migration defaults existing workspace rows to disabled", () => {
    const directory = mkdtempSync(join(tmpdir(), "structsmith-legacy-settings-"));
    const legacyMigrations = join(directory, "migrations");
    mkdirSync(legacyMigrations);
    for (const file of readdirSync(migrationsDir).filter((file) => file < "0005")) {
      copyFileSync(join(migrationsDir, file), join(legacyMigrations, file));
    }
    const database = createDatabase(":memory:");
    try {
      runMigrations(database.sqlite, legacyMigrations);
      database.sqlite
        .query(
          "INSERT INTO workspaces (id, name, mode, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("existing", "Existing", "relaxed", 1, "2026-01-01", "2026-01-01");
      expect(runMigrations(database.sqlite, migrationsDir).applied).toEqual([
        "0005_workspace_settings.sql",
      ]);
      const services = createServices(new DrizzleStore(database.db), new InMemoryEventBus());
      expect(services.workspaces.get("existing").settings).toEqual({ automaticExport: "disabled" });
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("JSON export and both import modes preserve automatic export settings", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({
        name: "Portable",
        settings: { automaticExport: "mermaid" },
      });
      const document = WorkspaceDocumentSchema.parse(
        JSON.parse(JSON.stringify(services.model.getDocument(workspace.id))),
      );
      expect(document.workspace.settings).toEqual({ automaticExport: "mermaid" });
      const imported = services.imports.importDocument(document);
      expect(services.workspaces.get(imported.id).settings).toEqual({
        automaticExport: "mermaid",
      });
      services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
      services.imports.importDocument(document, { mode: "overwrite" });
      expect(services.workspaces.get(workspace.id).settings).toEqual({
        automaticExport: "mermaid",
      });
    } finally {
      close();
    }
  });

  test("restoring an architecture snapshot preserves current workspace settings", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Snapshot" });
      const snapshot = services.snapshots.create(workspace.id, "Initial");
      services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
      services.snapshots.restore(snapshot.id);
      expect(services.workspaces.get(workspace.id).settings).toEqual({ automaticExport: "json" });
    } finally {
      close();
    }
  });
});
