import type { Viewport } from "@xyflow/react";
import type { Selection } from "@/store/editor";

export interface ViewLocation {
  viewId: string;
  viewport: Viewport;
  selection: Selection;
}

/** Cameras left behind while moving through the view tree, plus which view a descent started from. */
export interface ViewNavigation {
  saved: Record<string, ViewLocation>;
  enteredFrom: Record<string, string>;
}

export const emptyNavigation = (): ViewNavigation => ({ saved: {}, enteredFrom: {} });

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
