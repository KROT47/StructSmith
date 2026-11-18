import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTO_EXPORT_DELAY_MS, WorkspaceDocumentSchema } from "@structsmith/contracts";
import { createTestContext } from "../../../tests/helpers";
import { AutoExportScheduler } from "./auto-export";
import { normalizeWorkspaceFiles, readWorkspaceFiles } from "./workspace-files";

function exportedFile(output: string, extension = "json"): string {
  const filename = readdirSync(output).find((file) => file.endsWith(`.${extension}`));
  if (!filename) throw new Error(`Missing ${extension} export`);
  return join(output, filename);
}

const cleanups: (() => void)[] = [];
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  jest.useRealTimers();
});

function setup(name = "Example Workspace") {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-auto-export-"));
  const context = createTestContext();
  const output = join(directory, "auto-exports");
  const scheduler = new AutoExportScheduler(context.services, output, new Map());
  cleanups.push(() => {
    scheduler.close();
    context.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace = context.services.workspaces.create({ id: "example-workspace", name });
  const read = () =>
    WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(exportedFile(output), "utf8")));
  return { ...context, directory, output, scheduler, workspace, read };
}

test("JSON is mandatory even with Mermaid disabled and no views", () => {
  const { services, workspace, output, read } = setup();
  services.elements.create(workspace.id, { name: "API", kind: "softwareSystem" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS - 1);
  expect(existsSync(output)).toBe(false);
  jest.advanceTimersByTime(1);
  expect(read()).toEqual(services.model.getDocument(workspace.id));
  expect(readdirSync(output)).toEqual(["example-workspace.json"]);
});

test("JSON debounces model, record, metadata and layout changes together", () => {
  const { services, workspace, output, read } = setup();
  const element = services.elements.create(workspace.id, {
    name: "API",
    kind: "softwareSystem",
  }).result;
  const view = services.views.create(workspace.id, {
    name: "Runtime",
    kind: "custom",
    elementIds: [element.id],
  }).result;
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  const initial = readFileSync(exportedFile(output), "utf8");
  services.views.saveLayout(workspace.id, view.id, [{ elementId: element.id, x: 42, y: 25 }]);
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS - 1);
  services.records.create(workspace.id, { kind: "decision", title: "Use SQLite" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS - 1);
  expect(readFileSync(exportedFile(output), "utf8")).toBe(initial);
  jest.advanceTimersByTime(1);
  expect(read().views[0]?.elements[0]).toMatchObject({ x: 42, y: 25 });
  expect(read().records[0]?.title).toBe("Use SQLite");
  services.views.delete(workspace.id, view.id);
  services.workspaces.update(workspace.id, { description: "Updated" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(read().views).toEqual([]);
  expect(read().workspace.description).toBe("Updated");
});

test("Mermaid setting saves export JSON and Markdown immediately and repeatedly", () => {
  const { services, workspace, output, read } = setup();
  const element = services.elements.create(workspace.id, { name: "Before", kind: "person" }).result;
  services.views.create(workspace.id, { name: "First", kind: "custom", elementIds: [element.id] });
  services.views.create(workspace.id, { name: "Second", kind: "custom" });
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  expect(
    readdirSync(output)
      .map((file) => file.split(".").at(-1))
      .sort(),
  ).toEqual(["json", "md"]);
  expect(read().views).toHaveLength(2);
  const file = exportedFile(output, "md");
  expect(readFileSync(file, "utf8").match(/^```mermaid$/gm)).toHaveLength(2);
  services.elements.update(workspace.id, element.id, { name: "After" });
  expect(readFileSync(file, "utf8")).not.toContain("After");
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  expect(readFileSync(file, "utf8")).toContain("After");
});

test("disabling Mermaid removes Markdown but continues saving JSON", () => {
  const { services, workspace, output, read } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  expect(readFileSync(exportedFile(output, "md"), "utf8")).toContain("# Example Workspace\n");
  services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
  expect(readdirSync(output).some((file) => file.endsWith(".md"))).toBe(false);
  services.elements.create(workspace.id, { name: "Still persisted", kind: "person" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(read().elements[0]?.name).toBe("Still persisted");
});

test("renaming retains file paths and deleting removes both owned files", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  services.workspaces.update(workspace.id, { name: "Renamed" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(readdirSync(output)).toHaveLength(2);
  expect(readdirSync(output).sort()).toEqual(["example-workspace.json", "example-workspace.md"]);
  expect(readFileSync(join(output, "example-workspace.json"), "utf8")).toContain(
    '"name": "Renamed"',
  );
  services.elements.create(workspace.id, { name: "Pending", kind: "person" });
  services.workspaces.delete(workspace.id);
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(readdirSync(output)).toEqual([]);
});

test("long Unicode names use the workspace ID in filenames", () => {
  const { services, workspace, output } = setup("Shared Workspace");
  const second = services.workspaces.create({ name: "Other Workspace" });
  const long = services.workspaces.create({ name: "ﬃ".repeat(100) });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  const files = readdirSync(output);
  expect(files).toHaveLength(3);
  expect(files.sort()).toEqual([workspace.id, second.id, long.id].map((id) => `${id}.json`).sort());
  expect(
    new Set(
      files.map(
        (file) =>
          WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(join(output, file), "utf8")))
            .workspace.id,
      ),
    ),
  ).toEqual(new Set([workspace.id, second.id, long.id]));
});

test("Mermaid preserves view membership, direction and renamed headings", () => {
  const { services, workspace, output } = setup("../../Мой Workspace");
  const shown = services.elements.create(workspace.id, {
    name: "Shown API",
    kind: "softwareSystem",
  }).result;
  services.elements.create(workspace.id, { name: "Outside View", kind: "softwareSystem" });
  const first = services.views.create(workspace.id, {
    name: "First",
    kind: "custom",
    elementIds: [shown.id],
    settings: { autoLayoutDirection: "TB" },
  }).result;
  services.views.create(workspace.id, { name: "Empty", kind: "custom" });
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const file = exportedFile(output, "md");
  expect(readFileSync(file, "utf8")).toContain("```mermaid\nflowchart TB");
  expect(readFileSync(file, "utf8")).not.toContain("Outside View");
  expect(readFileSync(file, "utf8").match(/^```mermaid$/gm)).toHaveLength(2);
  services.views.update(workspace.id, first.id, { name: "Renamed" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(readFileSync(file, "utf8")).toContain("## Renamed\n");
  expect(readFileSync(file, "utf8")).not.toContain("## First\n");
});

test("MCP batches and imports always produce JSON", () => {
  const { services, workspace, output, read } = setup();
  services.model.applyOperations(
    workspace.id,
    { operations: [{ op: "createElement", data: { name: "Via MCP", kind: "person" } }] },
    "mcp",
  );
  const document = services.model.getDocument(workspace.id);
  const imported = services.imports.importDocument(document, { name: "Imported Workspace" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(read().elements[0]?.name).toBe("Via MCP");
  expect(readdirSync(output)).toContain(`${imported.id}.json`);
});

test("close flushes the latest pending JSON before the database closes", () => {
  const { services, workspace, scheduler, read } = setup();
  services.elements.create(workspace.id, { name: "Last second", kind: "person" });
  scheduler.close();
  expect(read().elements[0]?.name).toBe("Last second");
  expect(() => jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS)).not.toThrow();
});

test("filesystem errors are logged and retried without losing pending JSON", () => {
  const { services, workspace, output, read } = setup();
  writeFileSync(output, "blocked");
  const warning = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    services.elements.create(workspace.id, { name: "Pending", kind: "person" });
    expect(() => jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS)).not.toThrow();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(`retrying in ${AUTO_EXPORT_DELAY_MS / 1000} seconds:`),
      expect.any(Error),
    );
    rmSync(output);
    jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
    expect(read().elements[0]?.name).toBe("Pending");
  } finally {
    warning.mockRestore();
  }
});

test("swapping names cannot overwrite or delete another workspace's JSON", () => {
  const { services, workspace, output } = setup("First");
  const other = services.workspaces.create({ name: "Second" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  services.workspaces.update(workspace.id, { name: "Temporary" });
  services.workspaces.update(other.id, { name: "First" });
  services.workspaces.update(workspace.id, { name: "Second" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  const documents = readdirSync(output).map((file) =>
    WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(join(output, file), "utf8"))),
  );
  expect(documents).toHaveLength(2);
  expect(
    new Map(documents.map((document) => [document.workspace.id, document.workspace.name])),
  ).toEqual(
    new Map([
      [workspace.id, "Second"],
      [other.id, "First"],
    ]),
  );
});

test("workspace names that used to collide save independent files named by ID", () => {
  const { services, output } = setup("A B");
  services.workspaces.create({ id: "other-id", name: "A-B" });
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  expect(readFileSync(join(output, "other-id.json"), "utf8")).toContain('"name": "A-B"');
  expect(readdirSync(output)).toHaveLength(2);
});

test("closing saves the other pending workspaces even if one path is blocked", () => {
  const { services, workspace, output, scheduler } = setup();
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  const blocked = join(output, `${workspace.id}.json`);
  rmSync(blocked, { force: true });
  mkdirSync(blocked);
  services.elements.create(workspace.id, { name: "Blocked edit", kind: "person" });
  services.workspaces.create({ id: "available", name: "Available" });
  expect(() => scheduler.close()).toThrow(AggregateError);
  expect(readFileSync(join(output, "available.json"), "utf8")).toContain('"name": "Available"');
});

test("edits preserve the normalized path in the source folder", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-export-name-"));
  const context = createTestContext();
  try {
    const workspace = context.services.workspaces.create({
      id: "client-portal",
      name: "Client Portal",
      settings: { automaticExport: "mermaid" },
    });
    const document = context.services.model.getDocument(workspace.id);
    const nested = join(directory, "team");
    mkdirSync(nested);
    const oldFile = join(nested, "Client-Portal.JSON");
    writeFileSync(oldFile, JSON.stringify(document));
    const paths = normalizeWorkspaceFiles(readWorkspaceFiles(directory));
    const scheduler = new AutoExportScheduler(context.services, directory, paths);
    try {
      context.services.workspaces.update(workspace.id, { name: "Updated Portal" });
      scheduler.flush();
      expect(readdirSync(directory)).toEqual(["team"]);
      expect(readdirSync(nested).sort()).toEqual(["client-portal.json", "client-portal.md"]);
      expect(readFileSync(join(nested, "client-portal.json"), "utf8")).toContain(
        '"name": "Updated Portal"',
      );
    } finally {
      scheduler.close();
    }
  } finally {
    context.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("optional Mermaid never overwrites or deletes an unrelated Markdown file", () => {
  const { services, workspace, output } = setup();
  jest.advanceTimersByTime(AUTO_EXPORT_DELAY_MS);
  const markdown = join(output, "example-workspace.md");
  writeFileSync(markdown, "User-owned notes");
  const warning = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(markdown), expect.any(Error));
    expect(readFileSync(join(output, "example-workspace.json"), "utf8")).toContain(
      '"automaticExport": "mermaid"',
    );
    services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
    services.workspaces.delete(workspace.id);
    expect(readdirSync(output)).toEqual(["example-workspace.md"]);
    expect(readFileSync(markdown, "utf8")).toBe("User-owned notes");
  } finally {
    warning.mockRestore();
  }
});
