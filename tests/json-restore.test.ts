import { expect, test } from "bun:test";
import { WorkspaceDocumentSchema } from "@structsmith/contracts";
import { createTestContext, createWorkspace } from "./helpers";

test("startup restore preserves the complete document and clears prior workspaces and history", () => {
  const source = createTestContext();
  const target = createTestContext();
  try {
    const workspace = source.services.workspaces.create({
      id: "original-workspace",
      name: "Portal",
      settings: { automaticExport: "mermaid" },
    });
    source.services.model.applyOperations(workspace.id, {
      operations: [
        { op: "createElement", ref: "system", data: { kind: "softwareSystem", name: "Portal" } },
        {
          op: "createElement",
          ref: "api",
          data: { kind: "container", parentId: "@system", name: "API" },
        },
        { op: "createElement", ref: "customer", data: { kind: "person", name: "Customer" } },
        {
          op: "createRelationship",
          ref: "uses",
          data: {
            sourceElementId: "@customer",
            targetElementId: "@api",
            description: "Uses",
            interactionStyle: "sync",
          },
        },
        {
          op: "createView",
          ref: "view",
          data: { name: "Context", kind: "custom", elementIds: ["@api", "@customer"] },
        },
        { op: "setLayout", viewId: "@view", entries: [{ elementId: "@api", x: 42, y: 84 }] },
        {
          op: "createBoundary",
          data: {
            viewId: "@view",
            kind: "environment",
            name: "Production",
            layer: "deployment",
            elementIds: ["@api"],
          },
        },
        {
          op: "createRecord",
          data: { kind: "decision", title: "Use HTTP", status: "open", linkedElementIds: ["@api"] },
        },
      ],
    });
    const document = WorkspaceDocumentSchema.parse(
      JSON.parse(JSON.stringify(source.services.model.getDocument(workspace.id))),
    );
    const stale = createWorkspace(target.services, "Stale");
    target.services.snapshots.create(stale.id, "Before restart");
    let events = 0;
    target.bus.subscribe(() => events++);

    target.services.imports.restoreDocuments([document]);

    expect(target.services.workspaces.list()).toEqual([document.workspace]);
    expect(target.services.model.getDocument(workspace.id)).toEqual(document);
    expect(target.services.activity.list(workspace.id)).toEqual([]);
    expect(target.services.snapshots.list(workspace.id)).toEqual([]);
    expect(events).toBe(0);
    target.services.imports.restoreDocuments([]);
    expect(target.services.workspaces.list()).toEqual([]);
  } finally {
    source.close();
    target.close();
  }
});

test("startup restore rolls back the complete reset when a document is invalid", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = createWorkspace(services, "Kept on failure");
    services.elements.create(workspace.id, { kind: "person", name: "Customer" });
    const before = services.model.getDocument(workspace.id);
    const invalid = structuredClone(before);
    invalid.workspace = { ...invalid.workspace, id: "incoming" };

    expect(() => services.imports.restoreDocuments([invalid])).toThrow();
    expect(services.model.getDocument(workspace.id)).toEqual(before);

    expect(() => services.imports.restoreDocuments([before, before])).toThrow();
    expect(services.model.getDocument(workspace.id)).toEqual(before);
  } finally {
    close();
  }
});

test("duplicate entity IDs in different documents abort the complete restore", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = createWorkspace(services, "Original");
    services.elements.create(workspace.id, { kind: "person", name: "Customer" });
    const original = services.model.getDocument(workspace.id);
    const duplicate = structuredClone(original);
    duplicate.workspace.id = "duplicate-workspace";
    for (const element of duplicate.elements) element.workspaceId = duplicate.workspace.id;

    expect(() => services.imports.restoreDocuments([original, duplicate])).toThrow(
      'Could not restore workspace "duplicate-workspace"',
    );
    expect(services.workspaces.list()).toEqual([original.workspace]);
    expect(services.model.getDocument(workspace.id)).toEqual(original);
  } finally {
    close();
  }
});

test("startup restore rejects containment cycles instead of silently changing the JSON model", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = createWorkspace(services);
    const element = services.elements.create(workspace.id, {
      kind: "container",
      name: "API",
    }).result;
    const original = services.model.getDocument(workspace.id);
    const invalid = structuredClone(original);
    const copiedElement = invalid.elements[0];
    if (!copiedElement) throw new Error("Missing element");
    copiedElement.parentId = element.id;

    expect(() => services.imports.restoreDocuments([invalid])).toThrow("Invalid references");
    expect(services.model.getDocument(workspace.id)).toEqual(original);
  } finally {
    close();
  }
});

test("startup restore rejects duplicate view memberships instead of silently collapsing them", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = createWorkspace(services);
    const element = services.elements.create(workspace.id, {
      kind: "person",
      name: "Customer",
    }).result;
    services.views.create(workspace.id, {
      name: "Context",
      kind: "custom",
      elementIds: [element.id],
    });
    const original = services.model.getDocument(workspace.id);
    const invalid = structuredClone(original);
    const view = invalid.views[0];
    const entry = view?.elements[0];
    if (!view || !entry) throw new Error("Missing view membership");
    view.elements.push({ ...entry, x: entry.x + 100 });

    expect(() => services.imports.restoreDocuments([invalid])).toThrow("Invalid references");
    expect(services.model.getDocument(workspace.id)).toEqual(original);
  } finally {
    close();
  }
});
