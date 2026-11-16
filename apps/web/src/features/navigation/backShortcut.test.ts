import { expect, test } from "bun:test";
import {
  createDiagramDeleteGuard,
  hasDeletableDiagramSelection,
  isPlainDeleteKey,
  shouldGoBackOnDeleteKey,
} from "./backShortcut";

const press = (
  key: string,
  extra: {
    repeat?: boolean;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  } = {},
) => ({ key, ...extra });

test("plain Backspace and Delete are the back shortcut", () => {
  expect(isPlainDeleteKey(press("Backspace"))).toBe(true);
  expect(isPlainDeleteKey(press("Delete"))).toBe(true);
  expect(isPlainDeleteKey(press("Backspace", { repeat: true }))).toBe(false);
  expect(isPlainDeleteKey(press("Backspace", { metaKey: true }))).toBe(false);
  expect(isPlainDeleteKey(press("Delete", { ctrlKey: true }))).toBe(false);
  expect(isPlainDeleteKey(press("Delete", { altKey: true }))).toBe(false);
  expect(isPlainDeleteKey(press("Backspace", { shiftKey: true }))).toBe(false);
  expect(isPlainDeleteKey(press("Escape"))).toBe(false);
});

test("only a selected deletable element or relationship blocks the back shortcut", () => {
  const element = { selected: true };
  const boundary = { selected: true, deletable: false };
  const relationship = { selected: true, deletable: true };
  const merged = { selected: true, deletable: false };
  const idle = { selected: false };

  expect(hasDeletableDiagramSelection([], [])).toBe(false);
  expect(hasDeletableDiagramSelection([boundary], [])).toBe(false);
  expect(hasDeletableDiagramSelection([idle], [merged])).toBe(false);
  expect(hasDeletableDiagramSelection([], [merged])).toBe(false);
  expect(hasDeletableDiagramSelection([element], [])).toBe(true);
  expect(hasDeletableDiagramSelection([], [relationship])).toBe(true);
  expect(hasDeletableDiagramSelection([boundary, element], [])).toBe(true);
});

test("Backspace and Delete go back only when the diagram has nothing to delete", () => {
  const empty: { selected?: boolean; deletable?: boolean }[] = [];
  const selected = [{ selected: true }];
  expect(shouldGoBackOnDeleteKey(press("Backspace"), empty, empty)).toBe(true);
  expect(shouldGoBackOnDeleteKey(press("Delete"), empty, empty)).toBe(true);
  expect(
    shouldGoBackOnDeleteKey(press("Backspace"), [{ selected: true, deletable: false }], empty),
  ).toBe(true);
  expect(shouldGoBackOnDeleteKey(press("Backspace"), selected, empty)).toBe(false);
  expect(shouldGoBackOnDeleteKey(press("Delete"), empty, selected)).toBe(false);
  expect(shouldGoBackOnDeleteKey(press("Backspace", { metaKey: true }), empty, empty)).toBe(false);
  expect(shouldGoBackOnDeleteKey(press("Enter"), empty, empty)).toBe(false);
});

test("a delete key used to go back cannot delete the selection restored on the previous view", () => {
  const guard = createDiagramDeleteGuard();
  const restored = [{ selected: true }];
  expect(guard.allow()).toBe(true);
  expect(hasDeletableDiagramSelection(restored, [])).toBe(true);

  guard.hold();
  expect(guard.allow()).toBe(false);
  guard.release("a");
  expect(guard.allow()).toBe(false);
  guard.release("Backspace");
  expect(guard.allow()).toBe(true);

  guard.hold();
  guard.release("Delete");
  expect(guard.allow()).toBe(true);
  guard.hold();
  guard.release();
  expect(guard.allow()).toBe(true);
});
