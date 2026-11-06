import { expect, test } from "bun:test";
import { matchesLayoutKey } from "./keyboardLayout";

const press = (key: string, code = "", shiftKey = false) => ({ key, code, shiftKey });

test("letter shortcuts match the English key and the Russian key on the same position", () => {
  expect(matchesLayoutKey(press("i", "KeyI"), "i")).toBe(true);
  expect(matchesLayoutKey(press("I", "KeyI", true), "i")).toBe(true);
  expect(matchesLayoutKey(press("ш", "KeyI"), "i")).toBe(true);
  expect(matchesLayoutKey(press("Ш", "KeyI", true), "i")).toBe(true);
  expect(matchesLayoutKey(press("л", "KeyK"), "k")).toBe(true);
  expect(matchesLayoutKey(press("я", "KeyZ"), "z")).toBe(true);
  expect(matchesLayoutKey(press("ы", "KeyS"), "s")).toBe(true);
  expect(matchesLayoutKey(press("ф", "KeyA"), "a")).toBe(true);
  expect(matchesLayoutKey(press("с", "KeyC"), "c")).toBe(true);
  expect(matchesLayoutKey(press("м", "KeyV"), "v")).toBe(true);
  expect(matchesLayoutKey(press("а", "KeyF"), "f")).toBe(true);
  expect(matchesLayoutKey(press("ш", "KeyI"), "f")).toBe(false);
});

test("punctuation shortcuts follow the physical key when the Russian character differs", () => {
  expect(matchesLayoutKey(press("/", "Slash"), "/")).toBe(true);
  expect(matchesLayoutKey(press(".", "Slash"), "/")).toBe(true);
  expect(matchesLayoutKey(press(".", "Period"), "/")).toBe(false);
  expect(matchesLayoutKey(press("ю", "Period"), ".")).toBe(true);
  expect(matchesLayoutKey(press("-", "Minus"), "-")).toBe(true);
  expect(matchesLayoutKey(press("_", "Minus", true), "-")).toBe(false);
  expect(matchesLayoutKey(press("=", "Equal"), "=", "+")).toBe(true);
  expect(matchesLayoutKey(press("+", "Equal", true), "=", "+")).toBe(true);
  expect(matchesLayoutKey(press("+", "Equal", true), "=")).toBe(false);
  expect(matchesLayoutKey(press("+", "NumpadAdd"), "+")).toBe(true);
});

test("named keys stay exact", () => {
  expect(matchesLayoutKey(press("Escape", "Escape"), "Escape")).toBe(true);
  expect(matchesLayoutKey(press("Enter", "Enter"), "Escape")).toBe(false);
});
