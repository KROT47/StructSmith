import type { Viewport } from "@xyflow/react";
import type { Selection } from "@/store/editor";

export interface ViewLocation {
  viewId: string;
  viewport: Viewport;
  selection: Selection;
}

/**
 * Cameras left behind while moving between views, which view a descent started
 * from, and the visits Back returns through. The visit list is not rendered.
 */
export interface ViewNavigation {
  saved: Record<string, ViewLocation>;
  enteredFrom: Record<string, string>;
  /** View ids left behind, oldest first. */
  history: string[];
}

export const emptyNavigation = (): ViewNavigation => ({
  saved: {},
  enteredFrom: {},
  history: [],
});

export function rememberLocation(state: ViewNavigation, location: ViewLocation): ViewNavigation {
  return { ...state, saved: { ...state.saved, [location.viewId]: location } };
}

export function rememberDescent(
  state: ViewNavigation,
  fromId: string,
  toId: string,
): ViewNavigation {
  if (fromId === toId) return state;
  return { ...state, enteredFrom: { ...state.enteredFrom, [toId]: fromId } };
}

/** Append the view being left. Repeating the latest visit does not add another item. */
export function rememberVisit(state: ViewNavigation, viewId: string): ViewNavigation {
  if (!viewId || state.history.at(-1) === viewId) return state;
  return { ...state, history: [...state.history, viewId] };
}

/** Record a departure to another view. Back later returns along these visits. */
export function leaveForView(
  state: ViewNavigation,
  fromId: string | null,
  location: ViewLocation | null,
  toViewId: string,
  descend: boolean,
): ViewNavigation {
  if (!fromId || fromId === toViewId) return state;
  const saved = location ? rememberLocation(state, location) : state;
  const next = descend ? rememberDescent(saved, fromId, toViewId) : saved;
  return rememberVisit(next, fromId);
}

export function hasPreviousView(
  state: ViewNavigation,
  currentViewId: string | null,
  available: ReadonlySet<string>,
): boolean {
  return state.history.some((viewId) => viewId !== currentViewId && available.has(viewId));
}

/**
 * Step back to the previous visit. The view being left keeps its camera, but
 * is not added to the trail — Back consumes history instead of extending it.
 * Visits that no longer exist, and the view already on screen, are dropped.
 */
export function returnToPreviousView(
  state: ViewNavigation,
  currentViewId: string | null,
  location: ViewLocation | null,
  available: ReadonlySet<string>,
): { state: ViewNavigation; viewId: string | null } {
  const history = [...state.history];
  let viewId: string | null = null;
  while (history.length > 0) {
    const candidate = history.pop();
    if (candidate && candidate !== currentViewId && available.has(candidate)) {
      viewId = candidate;
      break;
    }
  }
  const trimmed = history.length === state.history.length ? state : { ...state, history };
  if (!viewId) return { state: trimmed, viewId: null };
  return {
    state: location ? rememberLocation(trimmed, location) : trimmed,
    viewId,
  };
}
