import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestContext } from "../../../tests/helpers";
import {
  normalizeWorkspaceFiles,
  readWorkspaceDocuments,
  readWorkspaceFiles,
  writeWorkspaceFile,
} from "./workspace-files";

test("workspace files preserve documents and report malformed files with their path", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-json-files-"));
  const context = createTestContext();
  try {
    const workspace = context.services.workspaces.create({ name: "Portable" });
    const document = context.services.model.getDocument(workspace.id);
    const file = join(directory, "portable.json");
    writeWorkspaceFile(file, `${JSON.stringify(document, null, 2)}\n`);
    expect(readWorkspaceDocuments(directory)).toEqual([document]);
    expect(readdirSync(directory)).toEqual(["portable.json"]);
    writeFileSync(join(directory, "broken.json"), "{ broken");
    expect(() => readWorkspaceDocuments(directory)).toThrow("broken.json");
    expect(readFileSync(file, "utf8")).toContain("Portable");
    rmSync(join(directory, "broken.json"));
    writeFileSync(join(directory, "invalid.json"), '{"formatVersion":9}');
    expect(() => readWorkspaceDocuments(directory)).toThrow("invalid.json");
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("identical nested copies collapse to an existing canonical file", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-legacy-json-"));
  const context = createTestContext();
  try {
    const workspace = context.services.workspaces.create({ id: "portable", name: "Portable" });
    const document = context.services.model.getDocument(workspace.id);
    const nested = join(directory, "portable", "nested");
    mkdirSync(nested, { recursive: true });
    const paths = [join(directory, "portable", "context.json"), join(nested, "containers.json")];
    for (const path of paths) writeWorkspaceFile(path, JSON.stringify(document));
    writeWorkspaceFile(join(directory, "portable.json"), JSON.stringify(document));

    expect(readWorkspaceDocuments(directory)).toEqual([document]);
    expect(
      readWorkspaceFiles(directory)
        .map(({ path }) => path)
        .sort(),
    ).toEqual([...paths, join(directory, "portable.json")].sort());
    context.services.imports.restoreDocuments(readWorkspaceDocuments(directory));
    expect(context.services.workspaces.list()).toEqual([document.workspace]);
    expect(context.services.model.getDocument(workspace.id)).toEqual(document);
    const canonical = join(directory, "portable.json");
    expect(normalizeWorkspaceFiles(readWorkspaceFiles(directory))).toEqual(
      new Map([["portable", canonical]]),
    );
    expect(readWorkspaceFiles(directory).map(({ path }) => path)).toEqual([canonical]);
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("conflicting duplicate workspace exports fail with both source paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-conflicting-json-"));
  const context = createTestContext();
  try {
    const workspace = context.services.workspaces.create({ name: "Portable" });
    const document = context.services.model.getDocument(workspace.id);
    mkdirSync(join(directory, "legacy"));
    const first = join(directory, "portable.json");
    const second = join(directory, "legacy", "context.json");
    writeWorkspaceFile(first, JSON.stringify(document));
    writeWorkspaceFile(
      second,
      JSON.stringify({ ...document, workspace: { ...document.workspace, name: "Different" } }),
    );

    expect(() => readWorkspaceDocuments(directory)).toThrow(first);
    expect(() => readWorkspaceDocuments(directory)).toThrow(second);
    expect(readWorkspaceFiles(directory)).toHaveLength(2);
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("workspace loading reports nested errors and skips symlinks and service files", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-nested-json-"));
  const outside = mkdtempSync(join(tmpdir(), "structsmith-outside-json-"));
  try {
    const broken = join(outside, "broken.json");
    writeFileSync(broken, "{broken");
    symlinkSync(broken, join(directory, "linked.json"));
    symlinkSync(outside, join(directory, "linked-directory"), "dir");
    const metadata = join(directory, ".structsmith");
    mkdirSync(metadata);
    writeFileSync(join(metadata, "metadata.json"), "{not a workspace");
    expect(readWorkspaceFiles(directory)).toEqual([]);
    mkdirSync(join(directory, "nested"));
    const nestedBroken = join(directory, "nested", "broken.json");
    writeFileSync(nestedBroken, "{broken");
    expect(() => readWorkspaceFiles(directory)).toThrow(nestedBroken);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test.each(["initial", "staging", "publication"])(
  "exchanged filenames are recoverable during %s",
  (phase) => {
    const directory = mkdtempSync(join(tmpdir(), "structsmith-rename-json-"));
    const context = createTestContext();
    try {
      const nested = join(directory, "team");
      mkdirSync(nested);
      const first = context.services.workspaces.create({ id: "first", name: "First" });
      const second = context.services.workspaces.create({ id: "second", name: "Second" });
      const firstDocument = JSON.stringify(context.services.model.getDocument(first.id));
      const secondDocument = JSON.stringify(context.services.model.getDocument(second.id));
      const firstPath = join(nested, "first.json");
      const secondPath = join(nested, "second.json");
      writeFileSync(secondPath, firstDocument);
      writeFileSync(firstPath, secondDocument);
      const firstStage = join(nested, ".structsmith-rename-first.tmp");
      const secondStage = join(nested, ".structsmith-rename-second.tmp");
      if (phase !== "initial") renameSync(secondPath, firstStage);
      if (phase === "publication") {
        renameSync(firstPath, secondStage);
        renameSync(firstStage, firstPath);
      }

      expect(normalizeWorkspaceFiles(readWorkspaceFiles(directory))).toEqual(
        new Map([
          ["first", firstPath],
          ["second", secondPath],
        ]),
      );
      expect(readdirSync(nested).sort()).toEqual(["first.json", "second.json"]);
      expect(readFileSync(firstPath, "utf8")).toBe(firstDocument);
      expect(readFileSync(secondPath, "utf8")).toBe(secondDocument);
    } finally {
      context.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("a blocking directory is detected before moving any JSON files", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-blocked-rename-"));
  const context = createTestContext();
  try {
    const first = context.services.workspaces.create({ id: "first", name: "First" });
    const second = context.services.workspaces.create({ id: "second", name: "Second" });
    const firstPath = join(directory, "a.json");
    const secondPath = join(directory, "b.json");
    const firstDocument = JSON.stringify(context.services.model.getDocument(first.id));
    const secondDocument = JSON.stringify(context.services.model.getDocument(second.id));
    writeFileSync(firstPath, firstDocument);
    writeFileSync(secondPath, secondDocument);
    const blocked = join(directory, "second.json");
    mkdirSync(blocked);

    expect(() => normalizeWorkspaceFiles(readWorkspaceFiles(directory))).toThrow(blocked);
    expect(readFileSync(firstPath, "utf8")).toBe(firstDocument);
    expect(readFileSync(secondPath, "utf8")).toBe(secondDocument);
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
