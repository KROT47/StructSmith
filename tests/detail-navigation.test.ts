import { expect, test } from "bun:test";
import {
  ancestorViews,
  detailViewElementIds,
  detailViewKind,
  detailViewsFor,
  parentView,
} from "@structsmith/domain";
import {
  emptyNavigation,
  rememberDescent,
  rememberLocation,
  type ViewLocation,
} from "../apps/web/src/features/navigation/history";
import { createTestContext } from "./helpers";

test("detail navigation matches both scope and level, excludes the current view, and never changes the model", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = services.workspaces.create({ name: "Navigation", mode: "strict" });
    const system = services.elements.create(workspace.id, {
      kind: "softwareSystem",
      name: "Payments",
    }).result;
    const container = services.elements.create(workspace.id, {
      kind: "container",
      name: "API",
      parentId: system.id,
    }).result;
    const overview = services.views.create(workspace.id, {
      kind: "systemContext",
      scopeElementId: system.id,
      name: "Overview",
    }).result;
    const create = (name: string) =>
      services.views.create(workspace.id, { kind: "container", scopeElementId: system.id, name })
        .result;
    const second = create("Z view");
    const first = create("A view");
    const components = services.views.create(workspace.id, {
      kind: "component",
      scopeElementId: container.id,
      name: "Components",
    }).result;
    const before = services.model.get(workspace.id);
    const views = services.views.list(workspace.id);
    expect(detailViewsFor(system, views).map((view) => view.id)).toEqual([first.id, second.id]);
    expect(detailViewsFor(system, views, first.id).map((view) => view.id)).toEqual([second.id]);
    expect(detailViewsFor(container, views).map((view) => view.id)).toEqual([components.id]);
    expect(detailViewsFor(system, [overview])).toEqual([]);
    expect(detailViewKind({ kind: "component" })).toBeNull();
    expect(services.model.get(workspace.id)).toEqual(before);
  } finally {
    close();
  }
});

test("detail creation seeds one level and raises external dependencies to appropriate context without copies", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = services.workspaces.create({ name: "Navigation", mode: "strict" });
    const system = services.elements.create(workspace.id, {
      kind: "softwareSystem",
      name: "Payments",
    }).result;
    const api = services.elements.create(workspace.id, {
      kind: "container",
      name: "API",
      parentId: system.id,
    }).result;
    const cache = services.elements.create(workspace.id, {
      kind: "container",
      name: "Cache",
      parentId: system.id,
    }).result;
    const component = services.elements.create(workspace.id, {
      kind: "component",
      name: "Handler",
      parentId: api.id,
    }).result;
    const external = services.elements.create(workspace.id, {
      kind: "softwareSystem",
      name: "Bank",
    }).result;
    const bankApi = services.elements.create(workspace.id, {
      kind: "container",
      name: "Bank API",
      parentId: external.id,
    }).result;
    services.elements.create(workspace.id, { kind: "softwareSystem", name: "Unrelated" });
    const relationships = [cache, bankApi].map(
      (target) =>
        services.relationships.create(workspace.id, {
          sourceElementId: component.id,
          targetElementId: target.id,
        }).result,
    );
    const elements = services.elements.list(workspace.id);
    expect(new Set(detailViewElementIds(system, elements, relationships))).toEqual(
      new Set([api.id, cache.id, external.id]),
    );
    const ids = detailViewElementIds(api, elements, relationships);
    expect(new Set(ids)).toEqual(new Set([component.id, cache.id, external.id]));
    const result = services.model.applyOperations(
      workspace.id,
      {
        operations: [
          {
            op: "createView",
            ref: "detail",
            data: {
              name: "API components",
              kind: "component",
              scopeElementId: api.id,
              elementIds: ids,
            },
          },
          { op: "autoLayoutView", viewId: "@detail", direction: "LR", algorithm: "dagre" },
        ],
      },
      "ui",
    );
    const id = result.appliedOperations.find((operation) => operation.ref === "detail")?.id;
    if (!id) throw new Error("No created view");
    expect(new Set(services.views.get(id).elements.map((entry) => entry.elementId))).toEqual(
      new Set(ids),
    );
    expect(services.elements.list(workspace.id)).toEqual(elements);
    if (!result.snapshotId) throw new Error("Missing undo snapshot");
    services.snapshots.restore(result.snapshotId);
    expect(services.views.list(workspace.id)).toHaveLength(0);
    expect(services.elements.list(workspace.id)).toEqual(elements);
  } finally {
    close();
  }
});

test("moving up follows the view tree and keeps the camera that was left behind", () => {
  const system = { id: "sys", kind: "softwareSystem" as const, parentId: null };
  const api = { id: "api", kind: "container" as const, parentId: system.id };
  const context = {
    id: "context",
    name: "Context",
    kind: "systemContext" as const,
    scopeElementId: system.id,
    elements: [{ elementId: system.id }],
  };
  const containers = {
    id: "containers",
    name: "Containers",
    kind: "container" as const,
    scopeElementId: system.id,
    elements: [{ elementId: api.id }],
  };
  const emptyContainers = {
    id: "empty",
    name: "A containers",
    kind: "container" as const,
    scopeElementId: system.id,
    elements: [] as { elementId: string }[],
  };
  const alsoContainers = {
    id: "also",
    name: "Z containers",
    kind: "container" as const,
    scopeElementId: system.id,
    elements: [{ elementId: api.id }],
  };
  const components = {
    id: "components",
    name: "Components",
    kind: "component" as const,
    scopeElementId: api.id,
    elements: [] as { elementId: string }[],
  };
  const notes = {
    id: "notes",
    name: "Notes",
    kind: "custom" as const,
    scopeElementId: null,
    elements: [] as { elementId: string }[],
  };
  const elements = [system, api];
  const views = [context, containers, emptyContainers, components, notes];

  expect(ancestorViews(components, views, elements).map((view) => view.id)).toEqual([
    context.id,
    containers.id,
  ]);
  expect(parentView(components, [context, emptyContainers, components], elements)?.id).toBe(
    emptyContainers.id,
  );
  expect(
    parentView(components, [containers, alsoContainers, components], elements, alsoContainers.id)
      ?.id,
  ).toBe(alsoContainers.id);
  expect(parentView(components, [context, components], elements)?.id).toBe(context.id);
  expect(parentView(containers, views, elements)?.id).toBe(context.id);
  expect(parentView(context, views, elements)).toBeNull();
  expect(parentView(notes, views, elements)).toBeNull();
  expect(parentView(components, views, [{ ...api, parentId: null }])).toBeNull();

  const left: ViewLocation = {
    viewId: containers.id,
    viewport: { x: 73, y: -28, zoom: 1.3 },
    selection: { type: "elements", ids: ["x", "y"] },
  };
  let state = rememberLocation(emptyNavigation(), left);
  state = rememberDescent(state, containers.id, components.id);
  expect(state.saved[containers.id]).toEqual(left);
  expect(state.enteredFrom[components.id]).toBe(containers.id);
  expect(rememberDescent(state, components.id, components.id)).toBe(state);
});
