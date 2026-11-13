import type {
  ArchitectureElement,
  ArchitectureRelationship,
  ViewKind,
} from "@structsmith/contracts";
import { detailViewsFor } from "./detail-views";

export interface ResolvedRelationship {
  /** Stable id: the relationship id for direct edges, a derived key otherwise. */
  id: string;
  sourceElementId: string;
  targetElementId: string;
  relationships: ArchitectureRelationship[];
  /** True when the edge stands in for relationships between hidden descendants. */
  implied: boolean;
  /**
   * Descriptions of same-direction relationships drawn on a view one level
   * below this one. Hidden children that are not on such a view do not contribute.
   */
  derivedDescription: string | null;
}

/** The membership a lower view needs in order to count as displaying a relationship. */
export interface DiagramViewRef {
  id: string;
  name: string;
  kind: ViewKind;
  scopeElementId: string | null;
  elements: readonly { elementId: string; hidden: boolean }[];
  relationships: readonly { relationshipId: string; hidden: boolean }[];
}

/**
 * A view that shows a software system but not its containers still has to show
 * the traffic in and out of that system. Relationships whose endpoints are not
 * on the view are lifted to their nearest visible ancestor and merged — the
 * same rule Structurizr calls "implied relationships".
 *
 * A relationship drawn on a view one level below is not drawn again when this
 * view already has the same direction. Its description is kept on the visible
 * relationship as `derivedDescription`. Children that are only in the model,
 * and are not placed on that lower view, stay ordinary implied edges.
 */
export function resolveRelationshipsForView(
  elements: readonly ArchitectureElement[],
  relationships: readonly ArchitectureRelationship[],
  visibleIds: ReadonlySet<string>,
  diagram?: { viewId: string; views: readonly DiagramViewRef[] },
): ResolvedRelationship[] {
  const byId = new Map(elements.map((element) => [element.id, element]));

  const nearestVisible = (elementId: string): string | null => {
    let current: string | null = elementId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (visibleIds.has(current)) return current;
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return null;
  };

  const merged = new Map<string, ResolvedRelationship>();

  for (const relationship of relationships) {
    const source = nearestVisible(relationship.sourceElementId);
    const target = nearestVisible(relationship.targetElementId);
    if (!source || !target || source === target) continue;

    const direct =
      source === relationship.sourceElementId && target === relationship.targetElementId;
    const key = direct ? relationship.id : `implied:${source}->${target}`;

    const existing = merged.get(key);
    if (existing) {
      existing.relationships.push(relationship);
      continue;
    }
    merged.set(key, {
      id: key,
      sourceElementId: source,
      targetElementId: target,
      relationships: [relationship],
      implied: !direct,
      derivedDescription: null,
    });
  }

  absorbDerivedRelationships(
    merged,
    byId,
    diagram ? relationshipsOnLowerViews(elements, relationships, visibleIds, diagram) : new Set(),
  );
  return [...merged.values()];
}

/**
 * Relationship ids whose two endpoints are both placed, and not hidden, on a
 * detail view one level below an element visible here. A container inside a
 * system counts only when the container view actually shows it.
 */
function relationshipsOnLowerViews(
  elements: readonly ArchitectureElement[],
  relationships: readonly ArchitectureRelationship[],
  visibleIds: ReadonlySet<string>,
  diagram: { viewId: string; views: readonly DiagramViewRef[] },
): Set<string> {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const shown = new Set<string>();
  for (const elementId of visibleIds) {
    const element = byId.get(elementId);
    if (!element) continue;
    for (const lower of detailViewsFor(element, diagram.views, diagram.viewId)) {
      const visible = new Set(
        lower.elements.filter((entry) => !entry.hidden).map((entry) => entry.elementId),
      );
      const hidden = new Set(
        lower.relationships.filter((entry) => entry.hidden).map((entry) => entry.relationshipId),
      );
      for (const relationship of relationships) {
        if (hidden.has(relationship.id)) continue;
        if (
          visible.has(relationship.sourceElementId) &&
          visible.has(relationship.targetElementId)
        ) {
          shown.add(relationship.id);
        }
      }
    }
  }
  return shown;
}

/**
 * When this view already shows a relationship in a direction, hide the
 * same-direction relationship that is drawn on the view one level below and
 * keep its description on the direct edge. A deeper relationship nested inside
 * one of those is the same arrow seen from further down, so it does not draw a
 * second line and does not add its text here. A peer the lower view does not
 * show stays an ordinary implied edge.
 */
function absorbDerivedRelationships(
  merged: Map<string, ResolvedRelationship>,
  byId: ReadonlyMap<string, ArchitectureElement>,
  shownOnLowerView: ReadonlySet<string>,
): void {
  if (shownOnLowerView.size === 0) return;

  const directByDirection = new Map<string, ResolvedRelationship[]>();
  for (const edge of merged.values()) {
    if (edge.implied) continue;
    const key = `${edge.sourceElementId}->${edge.targetElementId}`;
    const group = directByDirection.get(key);
    if (group) group.push(edge);
    else directByDirection.set(key, [edge]);
  }

  const absorbed: string[] = [];
  for (const [id, edge] of merged) {
    if (!edge.implied) continue;
    const direct = directByDirection.get(`${edge.sourceElementId}->${edge.targetElementId}`);
    if (!direct?.length) continue;
    const fromLowerView = edge.relationships.filter((relationship) =>
      shownOnLowerView.has(relationship.id),
    );
    if (fromLowerView.length === 0) continue;
    const derivedDescription = derivedDescriptionFrom(fromLowerView);
    for (const shown of direct) shown.derivedDescription = derivedDescription;
    const remaining = edge.relationships.filter(
      (relationship) =>
        !shownOnLowerView.has(relationship.id) && !refinesShown(byId, fromLowerView, relationship),
    );
    if (remaining.length === 0) absorbed.push(id);
    else edge.relationships = remaining;
  }
  for (const id of absorbed) merged.delete(id);
}

function isInside(
  byId: ReadonlyMap<string, ArchitectureElement>,
  ancestorId: string,
  elementId: string,
): boolean {
  let current: string | null = elementId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/** True when both ends sit inside the relationship already shown one level down. */
function refinesShown(
  byId: ReadonlyMap<string, ArchitectureElement>,
  shown: readonly ArchitectureRelationship[],
  relationship: ArchitectureRelationship,
): boolean {
  return shown.some(
    (outer) =>
      isInside(byId, outer.sourceElementId, relationship.sourceElementId) &&
      isInside(byId, outer.targetElementId, relationship.targetElementId),
  );
}

function derivedDescriptionFrom(relationships: readonly ArchitectureRelationship[]): string | null {
  const seen = new Set<string>();
  const descriptions: string[] = [];
  for (const relationship of relationships) {
    const description = relationship.description?.trim();
    if (!description || seen.has(description)) continue;
    seen.add(description);
    descriptions.push(description);
  }
  return descriptions.length > 0 ? descriptions.join(";\n") : null;
}

/**
 * The label an edge carries on a diagram. Shared so that layout (which has to
 * reserve room for it) and rendering agree on exactly the same text.
 */
export function edgeLabel(edge: ResolvedRelationship): string {
  const [first] = edge.relationships;
  if (!first) return "";

  if (edge.derivedDescription) {
    const own = first.description?.trim();
    return own ? `${edge.derivedDescription};\n${own}` : edge.derivedDescription;
  }

  if (edge.implied) {
    const descriptions = [
      ...new Set(edge.relationships.map((item) => item.description).filter(Boolean)),
    ];
    return descriptions.join(", ");
  }

  return [first.description, first.technology ? `[${first.technology}]` : null]
    .filter(Boolean)
    .join(" ");
}
