import { describe, expect, test } from "bun:test";
import type { DomainEvent } from "@structsmith/domain";
import { createTestContext } from "./helpers";

describe("workspace name uniqueness", () => {
  test.each(["Project", "project", "  PROJECT  "])(
    "creation rejects an existing name: %s",
    (name) => {
      const { services, bus, close } = createTestContext();
      try {
        const workspace = services.workspaces.create({ name: "Project" });
        const activity = services.activity.list(workspace.id);
        const events: DomainEvent[] = [];
        bus.subscribe((event) => events.push(event));

        expect(() => services.workspaces.create({ name })).toThrow(
          expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN", status: 409 }),
        );
        expect(services.workspaces.list()).toEqual([workspace]);
        expect(services.activity.list(workspace.id)).toEqual(activity);
        expect(events).toEqual([]);
      } finally {
        close();
      }
    },
  );

  test("renaming rejects another workspace's name but allows keeping its own", () => {
    const { services, close } = createTestContext();
    try {
      services.workspaces.create({ name: "Project" });
      const other = services.workspaces.create({ name: "Other" });
      const activity = services.activity.list(other.id);

      expect(() => services.workspaces.update(other.id, { name: " project " })).toThrow(
        expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN" }),
      );
      expect(services.workspaces.get(other.id)).toEqual(other);
      expect(services.activity.list(other.id)).toEqual(activity);
      expect(services.workspaces.update(other.id, { name: "OTHER" }).result.name).toBe("OTHER");
    } finally {
      close();
    }
  });

  test("JSON import requires an unused name and allows explicit overwrite", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Project" });
      const document = services.model.getDocument(workspace.id);

      expect(() => services.imports.importDocument(document)).toThrow(
        expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN" }),
      );
      expect(services.workspaces.list()).toEqual([workspace]);
      const imported = services.imports.importDocument(document, { name: "Copy" });
      expect(imported.id).not.toBe(workspace.id);
      expect(imported.name).toBe("Copy");

      expect(() =>
        services.imports.importDocument(document, { mode: "overwrite", name: " copy " }),
      ).toThrow(expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN" }));
      expect(services.model.getDocument(workspace.id)).toEqual(document);
      expect(services.imports.importDocument(document, { mode: "overwrite" }).revision).toBe(2);
    } finally {
      close();
    }
  });

  test("Mermaid import cannot create a workspace with an existing name", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Project" });
      expect(() =>
        services.imports.importMermaid("graph LR; A-->B", { name: " PROJECT " }),
      ).toThrow(expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN" }));
      expect(services.workspaces.list()).toEqual([workspace]);
    } finally {
      close();
    }
  });

  test("snapshot restore rejects a name taken since the snapshot without changing state", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Project" });
      const snapshot = services.snapshots.create(workspace.id, "Original");
      services.workspaces.update(workspace.id, { name: "Renamed" });
      services.workspaces.create({ name: "Project" });
      const document = services.model.getDocument(workspace.id);
      const snapshots = services.snapshots.list(workspace.id);

      expect(() => services.snapshots.restore(snapshot.id)).toThrow(
        expect.objectContaining({ code: "WORKSPACE_NAME_TAKEN" }),
      );
      expect(services.model.getDocument(workspace.id)).toEqual(document);
      expect(services.snapshots.list(workspace.id)).toEqual(snapshots);
    } finally {
      close();
    }
  });

  test("deleting a workspace frees its name", () => {
    const { services, close } = createTestContext();
    try {
      const workspace = services.workspaces.create({ name: "Project" });
      services.workspaces.delete(workspace.id);
      expect(services.workspaces.create({ name: "Project" }).name).toBe("Project");
    } finally {
      close();
    }
  });
});
