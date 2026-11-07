import type {
  ArchitectureElement,
  ArchitectureRelationship,
  ArchitectureView,
  ViewKind,
} from "@structsmith/contracts";

export function detailViewKind(element: Pick<ArchitectureElement, "kind">): ViewKind | null {
  if (element.kind === "softwareSystem") return "container";
  if (element.kind === "container") return "component";
  return null;
}

/** Scope alone is insufficient: a system context is not a system's interior. */
export function detailViewsFor<
  T extends Pick<ArchitectureView, "id" | "name" | "kind" | "scopeElementId">,
>(
  element: Pick<ArchitectureElement, "id" | "kind">,
  views: readonly T[],
  currentViewId: string | null = null,
): T[] {
  const kind = detailViewKind(element);
  if (!kind) return [];
  return views
    .filter(
      (view) =>
        view.id !== currentViewId && view.scopeElementId === element.id && view.kind === kind,
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

type NestedView = Pick<ArchitectureView, "id" | "name" | "kind" | "scopeElementId"> & {
  elements?: readonly { elementId: string }[];
};

type NestedElement = Pick<ArchitectureElement, "id" | "kind" | "parentId">;

const byViewName = (a: NestedView, b: NestedView): number =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** The system that owns an element, including when containers are nested. */
function owningSystemId(
  elementId: string | null,
  elements: readonly NestedElement[],
): string | null {
  if (!elementId) return null;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const seen = new Set<string>();
  let current = byId.get(elementId);
  while (current && !seen.has(current.id)) {
    if (current.kind === "softwareSystem") return current.id;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

/**
 * Levels above a view, nearest first. A missing intermediate view is skipped
 * so Back can still reach the nearest existing ancestor.
 */
function ascentSteps(
  view: NestedView,
  elements: readonly NestedElement[],
): { kind: ViewKind; scopeElementId: string; memberId: string }[] {
  if (view.kind === "component") {
    const systemId = owningSystemId(view.scopeElementId, elements);
    if (!systemId || !view.scopeElementId) return [];
    const steps: { kind: ViewKind; scopeElementId: string; memberId: string }[] = [];
    if (view.scopeElementId !== systemId) {
      steps.push({ kind: "container", scopeElementId: systemId, memberId: view.scopeElementId });
    }
    steps.push({ kind: "systemContext", scopeElementId: systemId, memberId: systemId });
    return steps;
  }
  if (view.kind === "container" && view.scopeElementId) {
    return [
      { kind: "systemContext", scopeElementId: view.scopeElementId, memberId: view.scopeElementId },
    ];
  }
  return [];
}

function chooseParent<T extends NestedView>(
  candidates: readonly T[],
  memberId: string,
  preferredParentId: string | null,
): T | null {
  if (candidates.length === 0) return null;
  const [chosen] = [...candidates].sort((a, b) => {
    const membership =
      Number(b.elements?.some((entry) => entry.elementId === memberId) ?? false) -
      Number(a.elements?.some((entry) => entry.elementId === memberId) ?? false);
    if (membership !== 0) return membership;
    const preference = Number(b.id === preferredParentId) - Number(a.id === preferredParentId);
    if (preference !== 0) return preference;
    return byViewName(a, b);
  });
  return chosen ?? null;
}

/** The view one structural level above this one, when that level exists. */
export function parentView<T extends NestedView>(
  view: T,
  views: readonly T[],
  elements: readonly NestedElement[],
  preferredParentId: string | null = null,
): T | null {
  for (const step of ascentSteps(view, elements)) {
    const chosen = chooseParent(
      views.filter(
        (candidate) =>
          candidate.id !== view.id &&
          candidate.kind === step.kind &&
          candidate.scopeElementId === step.scopeElementId,
      ),
      step.memberId,
      preferredParentId,
    );
    if (chosen) return chosen;
  }
  return null;
}

/** Ancestors from the outermost view to the immediate parent. */
export function ancestorViews<T extends NestedView>(
  view: T,
  views: readonly T[],
  elements: readonly NestedElement[],
  enteredFrom: Readonly<Record<string, string>> = {},
): T[] {
  const trail: T[] = [];
  const seen = new Set<string>([view.id]);
  let current: T | null = view;
  while (current) {
    const parent: T | null = parentView(current, views, elements, enteredFrom[current.id] ?? null);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    trail.unshift(parent);
    current = parent;
  }
  return trail;
}

/** One level of children and their connected context, using existing model IDs. */
export function detailViewElementIds(
  scope: ArchitectureElement,
  elements: readonly ArchitectureElement[],
  relationships: readonly ArchitectureRelationship[],
): string[] {
  if (!detailViewKind(scope)) return [];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const children = new Set(
    elements.filter((element) => element.parentId === scope.id).map((element) => element.id),
  );
  const visible = new Set(children);
  const childOfScope = (id: string): string | null => {
    const seen = new Set<string>();
    let element = byId.get(id);
    while (element && !seen.has(element.id)) {
      if (children.has(element.id)) return element.id;
      seen.add(element.id);
      element = element.parentId ? byId.get(element.parentId) : undefined;
    }
    return null;
  };
  const contextObject = (id: string): string | null => {
    const seen = new Set<string>([scope.id]);
    let element = byId.get(id);
    while (element && !seen.has(element.id)) {
      seen.add(element.id);
      if (!element.parentId || (scope.kind === "container" && element.parentId === scope.parentId))
        return element.id;
      element = byId.get(element.parentId);
    }
    return null;
  };
  for (const relationship of relationships) {
    const source = childOfScope(relationship.sourceElementId);
    const target = childOfScope(relationship.targetElementId);
    if (Boolean(source) === Boolean(target)) continue;
    const contextId = contextObject(
      source ? relationship.targetElementId : relationship.sourceElementId,
    );
    if (contextId) visible.add(contextId);
  }
  return elements.filter((element) => visible.has(element.id)).map((element) => element.id);
}
