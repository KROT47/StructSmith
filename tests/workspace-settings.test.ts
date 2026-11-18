import { describe, expect, test } from "bun:test";
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  WorkspaceDocumentSchema,
} from "@structsmith/contracts";
import { createDatabase, DrizzleStore } from "@structsmith/database";
import { createServices, type DomainEvent, InMemoryEventBus } from "@structsmith/domain";
import { createTestContext } from "./helpers";

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

  test("REST payload schemas reject unsupported automatic export formats", () => {
    for (const automaticExport of ["disabled", "mermaid"] as const) {
      expect(
        CreateWorkspaceSchema.parse({ name: "Valid", settings: { automaticExport } }).settings,
      ).toEqual({ automaticExport });
      expect(UpdateWorkspaceSchema.parse({ settings: { automaticExport } }).settings).toEqual({
        automaticExport,
      });
    }
    for (const automaticExport of ["json", "yaml"]) {
      expect(
        CreateWorkspaceSchema.safeParse({ name: "Invalid", settings: { automaticExport } }).success,
      ).toBe(false);
      expect(UpdateWorkspaceSchema.safeParse({ settings: { automaticExport } }).success).toBe(
        false,
      );
    }
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
        UpdateWorkspaceSchema.parse({ settings: { automaticExport: "mermaid" } }),
      );
      expect(updated.result).toMatchObject({
        name: "Unchanged",
        mode: "strict",
        description: "Description",
        settings: { automaticExport: "mermaid" },
        revision: updated.revision,
      });
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ settings: {} }));
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ name: "Renamed" }));
      expect(services.workspaces.get(workspace.id)).toMatchObject({
        name: "Renamed",
        mode: "strict",
        description: "Description",
        settings: { automaticExport: "mermaid" },
      });
      services.workspaces.update(workspace.id, UpdateWorkspaceSchema.parse({ mode: "relaxed" }));
      expect(services.workspaces.get(workspace.id)).toMatchObject({
        name: "Renamed",
        mode: "relaxed",
        settings: { automaticExport: "mermaid" },
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
        { settings: { automaticExport: "mermaid" } },
        { source: "mcp", expectedRevision: 1 },
      );
      services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
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
        { revision: 2, automaticExport: "mermaid" },
        { revision: 3, automaticExport: "mermaid" },
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
          { settings: { automaticExport: "mermaid" } },
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

  test("legacy JSON export settings normalize to disabled in documents and SQLite", () => {
    const database = createDatabase();
    try {
      const services = createServices(new DrizzleStore(database.db), new InMemoryEventBus());
      const workspace = services.workspaces.create({ name: "Legacy JSON export" });
      const legacyDocument = {
        ...services.model.getDocument(workspace.id),
        workspace: { ...workspace, settings: { automaticExport: "json" } },
      };
      expect(WorkspaceDocumentSchema.parse(legacyDocument).workspace.settings).toEqual({
        automaticExport: "disabled",
      });
      database.sqlite
        .query("UPDATE workspaces SET settings_json = ? WHERE id = ?")
        .run(JSON.stringify({ automaticExport: "json" }), workspace.id);
      expect(services.workspaces.get(workspace.id).settings).toEqual({
        automaticExport: "disabled",
      });
    } finally {
      database.close();
    }
  });

  test("generated schema defaults workspace rows to Mermaid export disabled", () => {
    const database = createDatabase();
    try {
      database.sqlite
        .query(
          "INSERT INTO workspaces (id, name, mode, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("existing", "Existing", "relaxed", 1, "2026-01-01", "2026-01-01");
      const services = createServices(new DrizzleStore(database.db), new InMemoryEventBus());
      expect(services.workspaces.get("existing").settings).toEqual({ automaticExport: "disabled" });
    } finally {
      database.close();
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
      const imported = services.imports.importDocument(document, { name: "Imported" });
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
      services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
      services.snapshots.restore(snapshot.id);
      expect(services.workspaces.get(workspace.id).settings).toEqual({
        automaticExport: "mermaid",
      });
    } finally {
      close();
    }
  });
});
