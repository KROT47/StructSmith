import { describe, expect, test } from "bun:test";
import type { ViewDetail, WorkspaceDocument } from "@structsmith/contracts";
import {
  edgeLabel,
  estimateLabelSize,
  type ResolvedRelationship,
  resolveRelationshipsForView,
  type Services,
  toMermaid,
} from "@structsmith/domain";
import { createTestContext, createWorkspace } from "./helpers";

/**
 * System context shows Portal, Billing, Mail and Customer. The container view
 * one level below shows API and Worker, so their relationships with Billing
 * and Mail are the derived descriptions of the system-level arrows.
 */
function createDuplicateDiagram(services: Services) {
  const workspace = createWorkspace(services, "Duplicate directions");
  const portal = services.elements.create(workspace.id, {
    kind: "softwareSystem",
    name: "Portal",
  }).result;
  const api = services.elements.create(workspace.id, {
    kind: "container",
    parentId: portal.id,
    name: "API",
  }).result;
  const worker = services.elements.create(workspace.id, {
    kind: "container",
    parentId: portal.id,
    name: "Worker",
  }).result;
  const billing = services.elements.create(workspace.id, {
    kind: "softwareSystem",
    name: "Billing",
  }).result;
  const mail = services.elements.create(workspace.id, {
    kind: "softwareSystem",
    name: "Mail",
  }).result;
  const customer = services.elements.create(workspace.id, {
    kind: "person",
    name: "Customer",
  }).result;

  const publishes = services.relationships.create(workspace.id, {
    sourceElementId: portal.id,
    targetElementId: billing.id,
    description: "Publishes summaries",
    technology: "HTTPS",
  }).result;
  const publishesInvoices = services.relationships.create(workspace.id, {
    sourceElementId: api.id,
    targetElementId: billing.id,
    description: "Publishes invoice status",
  }).result;
  const publishesPayments = services.relationships.create(workspace.id, {
    sourceElementId: worker.id,
    targetElementId: billing.id,
    description: "Publishes payment status",
  }).result;
  const sendsEvents = services.relationships.create(workspace.id, {
    sourceElementId: billing.id,
    targetElementId: portal.id,
    description: "Sends account events",
  }).result;
  const sendsChanges = services.relationships.create(workspace.id, {
    sourceElementId: billing.id,
    targetElementId: api.id,
    description: "Sends invoice changes",
  }).result;
  const asks = services.relationships.create(workspace.id, {
    sourceElementId: customer.id,
    targetElementId: api.id,
    description: "Asks for work",
  }).result;
  const notifies = services.relationships.create(workspace.id, {
    sourceElementId: portal.id,
    targetElementId: mail.id,
    description: null,
  }).result;
  const sendsReceipts = services.relationships.create(workspace.id, {
    sourceElementId: api.id,
    targetElementId: mail.id,
    description: "Sends receipts",
  }).result;

  const context = services.views.create(workspace.id, {
    name: "Duplicate direction context",
    kind: "systemContext",
    scopeElementId: portal.id,
    elementIds: [portal.id, billing.id, mail.id, customer.id],
  }).result;
  const containers = services.views.create(workspace.id, {
    name: "Duplicate direction containers",
    kind: "container",
    scopeElementId: portal.id,
    elementIds: [api.id, worker.id, billing.id, mail.id],
  }).result;

  return {
    workspace,
    portal,
    api,
    worker,
    billing,
    mail,
    customer,
    publishes,
    publishesInvoices,
    publishesPayments,
    sendsEvents,
    sendsChanges,
    asks,
    notifies,
    sendsReceipts,
    context,
    containers,
  };
}

function edgesOf(document: WorkspaceDocument, view: ViewDetail) {
  const visibleIds = new Set(
    view.elements.filter((entry) => !entry.hidden).map((entry) => entry.elementId),
  );
  const hidden = new Set(
    view.relationships.filter((entry) => entry.hidden).map((entry) => entry.relationshipId),
  );
  return resolveRelationshipsForView(
    document.elements,
    document.relationships.filter((relationship) => !hidden.has(relationship.id)),
    visibleIds,
    { viewId: view.id, views: document.views },
  );
}

function edgeBetween(
  edges: readonly ResolvedRelationship[],
  sourceId: string,
  targetId: string,
  relationshipId?: string,
): ResolvedRelationship {
  const edge = edges.find(
    (candidate) =>
      candidate.sourceElementId === sourceId &&
      candidate.targetElementId === targetId &&
      (relationshipId === undefined ||
        candidate.relationships.some((item) => item.id === relationshipId)),
  );
  if (!edge) throw new Error(`Missing edge ${sourceId} -> ${targetId}`);
  return edge;
}

describe("duplicate relationships on a diagram", () => {
  test("a system context diagram keeps the direct arrow and hides the derived one", () => {
    const { services, close } = createTestContext();
    const diagram = createDuplicateDiagram(services);
    const document = services.model.getDocument(diagram.workspace.id);
    const context = document.views.find((view) => view.id === diagram.context.id);
    const containers = document.views.find((view) => view.id === diagram.containers.id);
    if (!context || !containers) throw new Error("Missing test diagram");

    const contextEdges = edgesOf(document, context);
    const toBilling = edgeBetween(
      contextEdges,
      diagram.portal.id,
      diagram.billing.id,
      diagram.publishes.id,
    );
    const fromBilling = edgeBetween(
      contextEdges,
      diagram.billing.id,
      diagram.portal.id,
      diagram.sendsEvents.id,
    );
    const toMail = edgeBetween(
      contextEdges,
      diagram.portal.id,
      diagram.mail.id,
      diagram.notifies.id,
    );
    const asks = edgeBetween(contextEdges, diagram.customer.id, diagram.portal.id);

    expect(toBilling).toMatchObject({
      implied: false,
      id: diagram.publishes.id,
    });
    expect(new Set(toBilling?.derivedDescription?.split(";\n"))).toEqual(
      new Set(["Publishes invoice status", "Publishes payment status"]),
    );
    expect(edgeLabel(toBilling)).toBe(`${toBilling.derivedDescription};\nPublishes summaries`);
    expect(edgeLabel(toBilling)).not.toContain("[HTTPS]");

    expect(fromBilling).toMatchObject({ implied: false, id: diagram.sendsEvents.id });
    expect(fromBilling.derivedDescription).toBe("Sends invoice changes");
    expect(edgeLabel(fromBilling)).toBe("Sends invoice changes;\nSends account events");

    expect(toMail).toMatchObject({ implied: false, id: diagram.notifies.id });
    expect(toMail.derivedDescription).toBe("Sends receipts");
    expect(edgeLabel(toMail)).toBe("Sends receipts");

    expect(asks).toMatchObject({ implied: true, derivedDescription: null });
    expect(edgeLabel(asks)).toBe("Asks for work");

    const derivedIds = new Set([
      diagram.publishesInvoices.id,
      diagram.publishesPayments.id,
      diagram.sendsChanges.id,
      diagram.sendsReceipts.id,
    ]);
    expect(
      contextEdges.some((edge) => edge.relationships.some((item) => derivedIds.has(item.id))),
    ).toBe(false);
    expect(
      contextEdges.filter(
        (edge) =>
          edge.sourceElementId === diagram.portal.id && edge.targetElementId === diagram.billing.id,
      ),
    ).toHaveLength(1);

    const singleLine = estimateLabelSize("Publishes summaries");
    const wrapped = estimateLabelSize("Publishes invoice status;\nPublishes summaries");
    expect(wrapped && singleLine && wrapped.height > singleLine.height).toBe(true);

    const mermaid = toMermaid(document, { view: context });
    const publishLines = mermaid.split("\n").filter((line) => line.includes("Publishes"));
    expect(publishLines).toHaveLength(1);
    expect(publishLines[0]).toContain("Publishes invoice status");
    expect(publishLines[0]).toContain("Publishes payment status");
    expect(publishLines[0]).toContain("Publishes summaries");
    expect(publishLines[0]).not.toContain("[HTTPS]");
    expect(mermaid).toContain("Sends invoice changes; Sends account events");
    expect(mermaid).toContain("Sends receipts");
    expect(mermaid).toContain("Asks for work");

    const containerEdges = edgesOf(document, containers);
    expect(
      edgeBetween(containerEdges, diagram.api.id, diagram.billing.id, diagram.publishesInvoices.id),
    ).toMatchObject({ implied: false, derivedDescription: null });
    expect(
      edgeBetween(
        containerEdges,
        diagram.worker.id,
        diagram.billing.id,
        diagram.publishesPayments.id,
      ),
    ).toMatchObject({ implied: false, derivedDescription: null });
    expect(edgeLabel(edgeBetween(containerEdges, diagram.api.id, diagram.billing.id))).toBe(
      "Publishes invoice status",
    );

    close();
  });

  test("child relationships do not supply derived description until a level-down view shows them", () => {
    const { services, close } = createTestContext();
    const workspace = createWorkspace(services, "Context only");
    const portal = services.elements.create(workspace.id, {
      kind: "softwareSystem",
      name: "Portal",
    }).result;
    const api = services.elements.create(workspace.id, {
      kind: "container",
      parentId: portal.id,
      name: "API",
    }).result;
    const billing = services.elements.create(workspace.id, {
      kind: "softwareSystem",
      name: "Billing",
    }).result;
    const gateway = services.elements.create(workspace.id, {
      kind: "component",
      parentId: api.id,
      name: "Gateway",
    }).result;
    const publishes = services.relationships.create(workspace.id, {
      sourceElementId: portal.id,
      targetElementId: billing.id,
      description: "Publishes summaries",
    }).result;
    const invoices = services.relationships.create(workspace.id, {
      sourceElementId: api.id,
      targetElementId: billing.id,
      description: "Publishes invoice status",
    }).result;
    services.relationships.create(workspace.id, {
      sourceElementId: gateway.id,
      targetElementId: billing.id,
      description: "Publishes line items",
    });
    const context = services.views.create(workspace.id, {
      name: "Context",
      kind: "systemContext",
      scopeElementId: portal.id,
      elementIds: [portal.id, billing.id],
    }).result;
    services.views.create(workspace.id, {
      name: "API components",
      kind: "component",
      scopeElementId: api.id,
      elementIds: [gateway.id, billing.id],
    });

    const withoutContainer = services.model.getDocument(workspace.id);
    const contextView = withoutContainer.views.find((view) => view.id === context.id);
    if (!contextView) throw new Error("Missing context view");
    const before = edgesOf(withoutContainer, contextView);
    const direct = edgeBetween(before, portal.id, billing.id, publishes.id);
    expect(direct.derivedDescription).toBeNull();
    expect(edgeLabel(direct)).toBe("Publishes summaries");
    expect(before.some((edge) => edge.relationships.some((item) => item.id === invoices.id))).toBe(
      true,
    );
    expect(
      before.some(
        (edge) =>
          edge.implied &&
          edge.relationships.some((item) => item.description === "Publishes line items"),
      ),
    ).toBe(true);

    services.views.create(workspace.id, {
      name: "Containers",
      kind: "container",
      scopeElementId: portal.id,
      elementIds: [api.id, billing.id],
    });
    const withContainer = services.model.getDocument(workspace.id);
    const contextAfter = withContainer.views.find((view) => view.id === context.id);
    if (!contextAfter) throw new Error("Missing context view");
    const after = edgesOf(withContainer, contextAfter);
    const absorbed = edgeBetween(after, portal.id, billing.id, publishes.id);
    expect(absorbed.derivedDescription).toBe("Publishes invoice status");
    expect(edgeLabel(absorbed)).toBe("Publishes invoice status;\nPublishes summaries");
    expect(after.some((edge) => edge.relationships.some((item) => item.id === invoices.id))).toBe(
      false,
    );
    expect(
      after.some(
        (edge) =>
          edge.implied &&
          edge.relationships.some((item) => item.description === "Publishes line items"),
      ),
    ).toBe(true);

    close();
  });
});
