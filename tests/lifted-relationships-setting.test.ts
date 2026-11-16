import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { WorkspaceDocumentSchema } from "@structsmith/contracts";
import { createDatabase, DrizzleStore, runMigrations } from "@structsmith/database";
import { createServices, InMemoryEventBus, toMermaid } from "@structsmith/domain";
import { buildGraph } from "../apps/web/src/features/canvas/graph";
import { createTestContext, createWorkspace } from "./helpers";

const migrationsDir = fileURLToPath(new URL("../migrations", import.meta.url));

test("component views hide lifted relationships until the view setting says otherwise", () => {
  const { services, close } = createTestContext();
  try {
    const workspace = createWorkspace(services);
    const orchestrator = services.elements.create(workspace.id, {
      kind: "container",
      name: "Orchestrator",
    }).result;
    const workflow = services.elements.create(workspace.id, {
      kind: "component",
      name: "Workflow Orchestrator",
      parentId: orchestrator.id,
    }).result;
    const log = services.elements.create(workspace.id, {
      kind: "container",
      name: "Log Manager",
    }).result;
    const worker = services.elements.create(workspace.id, {
      kind: "container",
      name: "Worker",
    }).result;
    services.relationships.create(workspace.id, {
      sourceElementId: workflow.id,
      targetElementId: log.id,
      description: "logs",
    });
    services.relationships.create(workspace.id, {
      sourceElementId: orchestrator.id,
      targetElementId: worker.id,
      description: "assigns",
    });

    const components = services.views.create(workspace.id, {
      name: "Components",
      kind: "component",
      scopeElementId: orchestrator.id,
      elementIds: [orchestrator.id, log.id, worker.id],
    }).result;
    const containers = services.views.create(workspace.id, {
      name: "Containers",
      kind: "container",
      elementIds: [orchestrator.id, log.id, worker.id],
    }).result;
    expect(components.settings.hideLiftedRelationships).toBe(true);
    expect(containers.settings.hideLiftedRelationships).toBe(false);
    expect(
      services.views.create(workspace.id, {
        name: "Shown lifts",
        kind: "component",
        settings: { hideLiftedRelationships: false },
      }).result.settings.hideLiftedRelationships,
    ).toBe(false);

    const model = () => services.model.get(workspace.id);
    const detail = (id: string) => services.views.get(id);
    const labels = (viewId: string) =>
      buildGraph({
        view: detail(viewId),
        views: services.views.listDetailed(workspace.id),
        elements: model().elements,
        relationships: model().relationships,
        records: [],
      }).edges.map((edge) => edge.data?.label);

    expect(labels(components.id)).toEqual(["assigns"]);
    expect(labels(containers.id).sort()).toEqual(["assigns", "logs"]);

    services.views.update(workspace.id, components.id, {
      settings: { hideLiftedRelationships: false },
    });
    expect(labels(components.id).sort()).toEqual(["assigns", "logs"]);
    const shown = services.model.getDocument(workspace.id);
    const shownView = shown.views.find((view) => view.id === components.id);
    if (!shownView) throw new Error("Missing component view");
    expect(toMermaid(shown, { view: shownView })).toContain("logs");

    services.views.update(workspace.id, components.id, {
      settings: { hideLiftedRelationships: true },
    });
    expect(labels(components.id)).toEqual(["assigns"]);
    const hidden = services.model.getDocument(workspace.id);
    const hiddenView = hidden.views.find((view) => view.id === components.id);
    if (!hiddenView) throw new Error("Missing component view");
    expect(toMermaid(hidden, { view: hiddenView })).not.toContain("logs");
    expect(toMermaid(hidden, { view: hiddenView })).toContain("assigns");

    const withoutFlag = structuredClone(hidden);
    const importedView = withoutFlag.views.find((view) => view.id === components.id);
    if (!importedView) throw new Error("Missing component view");
    delete importedView.settings.hideLiftedRelationships;
    const imported = services.imports.importDocument(WorkspaceDocumentSchema.parse(withoutFlag));
    const restored = services.views.list(imported.id).find((view) => view.name === "Components");
    expect(restored?.settings.hideLiftedRelationships).toBe(true);
  } finally {
    close();
  }
});

test("a component view saved before the setting existed hides lifted relationships", () => {
  const database = createDatabase(":memory:");
  runMigrations(database.sqlite, migrationsDir);
  const services = createServices(new DrizzleStore(database.db), new InMemoryEventBus());
  try {
    const workspace = createWorkspace(services);
    const components = services.views.create(workspace.id, {
      name: "Components",
      kind: "component",
    }).result;
    const containers = services.views.create(workspace.id, {
      name: "Containers",
      kind: "container",
    }).result;
    database.sqlite.query("update views set settings_json = '{}' where id = ?").run(components.id);
    database.sqlite.query("update views set settings_json = '{}' where id = ?").run(containers.id);

    expect(services.views.get(components.id).settings.hideLiftedRelationships).toBe(true);
    expect(services.views.get(containers.id).settings.hideLiftedRelationships).toBe(false);
  } finally {
    database.close();
  }
});
