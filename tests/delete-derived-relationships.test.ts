import { describe, expect, test } from "bun:test";
import type { Services } from "@structsmith/domain";
import { createTestContext, createWorkspace } from "./helpers";

function idsOf(services: Services, workspaceId: string): Set<string> {
  return new Set(
    services.model.getDocument(workspaceId).relationships.map((relationship) => relationship.id),
  );
}

/**
 * The component view records the only description. The views above keep empty
 * arrows in the same direction so they can show that text as a derived
 * description.
 */
function createLogDiagram(services: Services) {
  const workspace = createWorkspace(services, "Derived delete");
  const darvis = services.elements.create(workspace.id, {
    kind: "softwareSystem",
    name: "Darvis",
  }).result;
  const runtime = services.elements.create(workspace.id, {
    kind: "softwareSystem",
    name: "AI Agent Runtime",
  }).result;
  const worker = services.elements.create(workspace.id, {
    kind: "container",
    parentId: darvis.id,
    name: "Darvis Worker",
  }).result;
  const logs = services.elements.create(workspace.id, {
    kind: "container",
    parentId: darvis.id,
    name: "Background Log Manager",
  }).result;
  const peer = services.elements.create(workspace.id, {
    kind: "container",
    parentId: darvis.id,
    name: "Peer",
  }).result;

  const source = services.relationships.create(workspace.id, {
    sourceElementId: runtime.id,
    targetElementId: logs.id,
    description: "Читает технический журнал задачи",
  }).result;
  const otherSource = services.relationships.create(workspace.id, {
    sourceElementId: runtime.id,
    targetElementId: logs.id,
    description: "Пишет метрики задачи",
  }).result;
  const contextShell = services.relationships.create(workspace.id, {
    sourceElementId: runtime.id,
    targetElementId: logs.id,
    description: "   ",
  }).result;
  const containerShell = services.relationships.create(workspace.id, {
    sourceElementId: runtime.id,
    targetElementId: logs.id,
    description: null,
  }).result;
  const described = services.relationships.create(workspace.id, {
    sourceElementId: darvis.id,
    targetElementId: runtime.id,
    description: "Передаёт задания для выполнения ролей",
  }).result;
  const lowerText = services.relationships.create(workspace.id, {
    sourceElementId: worker.id,
    targetElementId: runtime.id,
    description: "Передаёт задания ролям",
  }).result;
  const unrelatedEmpty = services.relationships.create(workspace.id, {
    sourceElementId: peer.id,
    targetElementId: runtime.id,
    description: null,
  }).result;

  const context = services.views.create(workspace.id, {
    name: "System Context",
    kind: "systemContext",
    scopeElementId: darvis.id,
    elementIds: [darvis.id, runtime.id, logs.id, peer.id],
  }).result;
  const containers = services.views.create(workspace.id, {
    name: "System Containers",
    kind: "container",
    scopeElementId: darvis.id,
    elementIds: [worker.id, logs.id, runtime.id, peer.id],
  }).result;
  const components = services.views.create(workspace.id, {
    name: "Darvis Worker Components",
    kind: "component",
    scopeElementId: worker.id,
    elementIds: [runtime.id, logs.id, worker.id],
  }).result;

  services.views.saveLayout(
    workspace.id,
    context.id,
    [],
    [{ relationshipId: contextShell.id }, { relationshipId: described.id }],
  );
  services.views.saveLayout(
    workspace.id,
    containers.id,
    [],
    [
      { relationshipId: containerShell.id },
      { relationshipId: lowerText.id },
      { relationshipId: unrelatedEmpty.id },
    ],
  );
  services.views.saveLayout(
    workspace.id,
    components.id,
    [],
    [{ relationshipId: source.id }, { relationshipId: otherSource.id }],
  );

  return {
    workspace,
    source,
    otherSource,
    contextShell,
    containerShell,
    described,
    lowerText,
    unrelatedEmpty,
  };
}

describe("deleting a relationship that feeds a derived description", () => {
  test("removes empty relationships that show its text on a higher view", () => {
    const { services, close } = createTestContext();
    const diagram = createLogDiagram(services);

    services.relationships.delete(diagram.workspace.id, diagram.source.id);

    const remaining = idsOf(services, diagram.workspace.id);
    expect(remaining.has(diagram.source.id)).toBe(false);
    expect(remaining.has(diagram.contextShell.id)).toBe(false);
    expect(remaining.has(diagram.containerShell.id)).toBe(false);
    expect(remaining.has(diagram.otherSource.id)).toBe(true);
    expect(remaining.has(diagram.described.id)).toBe(true);
    expect(remaining.has(diagram.lowerText.id)).toBe(true);
    expect(remaining.has(diagram.unrelatedEmpty.id)).toBe(true);

    const document = services.model.getDocument(diagram.workspace.id);
    const placed = document.views.flatMap((view) =>
      view.relationships.map((entry) => entry.relationshipId),
    );
    expect(placed).not.toContain(diagram.contextShell.id);
    expect(placed).not.toContain(diagram.containerShell.id);

    close();
  });

  test("keeps a relationship that has its own description", () => {
    const { services, close } = createTestContext();
    const diagram = createLogDiagram(services);

    services.relationships.delete(diagram.workspace.id, diagram.lowerText.id);

    const remaining = idsOf(services, diagram.workspace.id);
    expect(remaining.has(diagram.lowerText.id)).toBe(false);
    expect(remaining.has(diagram.described.id)).toBe(true);
    expect(remaining.has(diagram.source.id)).toBe(true);
    expect(remaining.has(diagram.contextShell.id)).toBe(true);

    close();
  });

  test("deleting an empty carrier leaves the relationship that supplied the text", () => {
    const { services, close } = createTestContext();
    const diagram = createLogDiagram(services);

    services.relationships.delete(diagram.workspace.id, diagram.containerShell.id);

    const remaining = idsOf(services, diagram.workspace.id);
    expect(remaining.has(diagram.containerShell.id)).toBe(false);
    expect(remaining.has(diagram.source.id)).toBe(true);
    expect(remaining.has(diagram.otherSource.id)).toBe(true);
    expect(remaining.has(diagram.contextShell.id)).toBe(true);

    close();
  });

  test("a batch can delete the source and a carrier that the source also removes", () => {
    const { services, close } = createTestContext();
    const diagram = createLogDiagram(services);

    const applied = services.model.applyOperations(diagram.workspace.id, {
      label: "Delete derived relationship",
      operations: [
        { op: "deleteRelationship", relationshipId: diagram.source.id },
        { op: "deleteRelationship", relationshipId: diagram.containerShell.id },
      ],
    });

    expect(applied.success).toBe(true);
    const remaining = idsOf(services, diagram.workspace.id);
    expect(remaining.has(diagram.source.id)).toBe(false);
    expect(remaining.has(diagram.containerShell.id)).toBe(false);
    expect(remaining.has(diagram.contextShell.id)).toBe(false);
    expect(remaining.has(diagram.otherSource.id)).toBe(true);

    close();
  });
});
