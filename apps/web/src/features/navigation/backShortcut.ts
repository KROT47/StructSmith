/** A node or edge as far as the Backspace/Delete shortcut needs to see it. */
export interface DiagramDeleteTarget {
  selected?: boolean;
  /** React Flow treats a missing flag as deletable. */
  deletable?: boolean;
}

export interface DeleteKeyEvent {
  key: string;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Plain Backspace or Delete, without a modifier and without key repeat. */
export function isPlainDeleteKey(event: DeleteKeyEvent): boolean {
  return (
    !event.repeat &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    (event.key === "Backspace" || event.key === "Delete")
  );
}

/** True when Backspace/Delete would remove something from the diagram. */
export function hasDeletableDiagramSelection(
  nodes: readonly DiagramDeleteTarget[],
  edges: readonly DiagramDeleteTarget[],
): boolean {
  const selectedAndDeletable = (item: DiagramDeleteTarget): boolean =>
    Boolean(item.selected) && item.deletable !== false;
  return nodes.some(selectedAndDeletable) || edges.some(selectedAndDeletable);
}

/**
 * Backspace and Delete remove the current diagram selection. When that
 * selection is empty, the same keys step back through view history.
 */
export function shouldGoBackOnDeleteKey(
  event: DeleteKeyEvent,
  nodes: readonly DiagramDeleteTarget[],
  edges: readonly DiagramDeleteTarget[],
): boolean {
  return isPlainDeleteKey(event) && !hasDeletableDiagramSelection(nodes, edges);
}

/**
 * Delete/Backspace that steps back is still held when the previous view
 * restores its selection. Repeats of that key must not delete the restored
 * element. The guard stays shut until the key is released.
 */
export function createDiagramDeleteGuard(): {
  hold(): void;
  release(key?: string): void;
  allow(): boolean;
} {
  let held = false;
  return {
    hold() {
      held = true;
    },
    release(key) {
      if (key !== undefined && key !== "Backspace" && key !== "Delete") return;
      held = false;
    },
    allow() {
      return !held;
    },
  };
}
