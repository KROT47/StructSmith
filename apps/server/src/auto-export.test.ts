import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceDocumentSchema } from "@structsmith/contracts";
import { createTestContext } from "../../../tests/helpers";
import { AutoExportScheduler } from "./auto-export";
import { createAppContext } from "./bootstrap";
import { loadConfig } from "./config";

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
  const scheduler = new AutoExportScheduler(context.services, output);
  cleanups.push(() => {
    scheduler.close();
    context.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace = context.services.workspaces.create({ name });
  return { ...context, directory, output, scheduler, workspace };
}

test("disabled workspaces do not create automatic exports", () => {
  const { services, workspace, output } = setup();
  services.views.create(workspace.id, { name: "Runtime", kind: "custom" });
  jest.advanceTimersByTime(5000);
  expect(existsSync(output)).toBe(false);
});

test.each(["json", "mermaid"] as const)(
  "saving %s settings exports immediately, including repeated saves",
  (automaticExport) => {
    const { services, workspace, output } = setup();
    const element = services.elements.create(workspace.id, {
      name: "Before save",
      kind: "softwareSystem",
    }).result;
    services.views.create(workspace.id, {
      name: "First View",
      kind: "custom",
      elementIds: [element.id],
    });
    services.views.create(workspace.id, { name: "Second View", kind: "custom" });

    services.workspaces.update(workspace.id, { settings: { automaticExport } });
    const file =
      automaticExport === "json"
        ? join(output, "example_workspace.json")
        : join(output, "example_workspace.md");
    if (automaticExport === "json") {
      expect(readdirSync(output)).toEqual(["example_workspace.json"]);
      expect(
        WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(file, "utf8"))).views,
      ).toHaveLength(2);
    } else {
      expect(readdirSync(output)).toEqual(["example_workspace.md"]);
      const markdown = readFileSync(file, "utf8");
      expect(markdown).toStartWith("# Example Workspace\n");
      expect(markdown).toContain("## First View\n\n```mermaid\n");
      expect(markdown).toContain("## Second View\n\n```mermaid\n");
      expect(markdown.match(/^```mermaid$/gm)).toHaveLength(2);
    }
    expect(readFileSync(file, "utf8")).toContain("Before save");

    services.elements.update(workspace.id, element.id, { name: "After save" });
    expect(readFileSync(file, "utf8")).not.toContain("After save");
    services.workspaces.update(workspace.id, { settings: { automaticExport } });
    expect(readFileSync(file, "utf8")).toContain("After save");
  },
);

test("JSON exports wait five seconds after the latest view update and contain current layout", () => {
  const { services, workspace, output } = setup("APIWorkspace Demo");
  const element = services.elements.create(workspace.id, {
    name: "API",
    kind: "softwareSystem",
  }).result;
  const view = services.views.create(workspace.id, {
    name: "Runtime View",
    kind: "custom",
    elementIds: [element.id],
  }).result;
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const file = join(output, "api_workspace_demo.json");
  const initial = readFileSync(file, "utf8");
  services.views.saveLayout(workspace.id, view.id, [{ elementId: element.id, x: 10, y: 15 }]);
  jest.advanceTimersByTime(4999);
  expect(readFileSync(file, "utf8")).toBe(initial);
  services.views.saveLayout(workspace.id, view.id, [{ elementId: element.id, x: 42, y: 25 }]);
  jest.advanceTimersByTime(4999);
  expect(readFileSync(file, "utf8")).toBe(initial);
  jest.advanceTimersByTime(1);
  const document = WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  expect(document.workspace.name).toBe("APIWorkspace Demo");
  expect(document.elements[0]?.name).toBe("API");
  expect(document.views[0]?.elements[0]).toMatchObject({ x: 42, y: 25 });
  expect(readdirSync(output)).toEqual(["api_workspace_demo.json"]);
});

test("JSON exports work without views and debounce all workspace changes together", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const file = join(output, "example_workspace.json");
  const initial = readFileSync(file, "utf8");
  expect(WorkspaceDocumentSchema.parse(JSON.parse(initial)).views).toEqual([]);
  services.views.create(workspace.id, { name: "First", kind: "custom" });
  jest.advanceTimersByTime(1000);
  services.views.create(workspace.id, { name: "Second", kind: "custom" });
  jest.advanceTimersByTime(4000);
  expect(readFileSync(file, "utf8")).toBe(initial);
  jest.advanceTimersByTime(1000);
  expect(WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(file, "utf8"))).views).toHaveLength(
    2,
  );
  expect(readdirSync(output)).toEqual(["example_workspace.json"]);
});

test("Mermaid exports an empty workspace and debounces all views together", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const file = join(output, "example_workspace.md");
  expect(readFileSync(file, "utf8")).toBe("# Example Workspace\n");
  services.views.create(workspace.id, { name: "First", kind: "custom" });
  jest.advanceTimersByTime(1000);
  services.views.create(workspace.id, { name: "Second", kind: "custom" });
  jest.advanceTimersByTime(4000);
  expect(readFileSync(file, "utf8")).toBe("# Example Workspace\n");
  jest.advanceTimersByTime(1000);
  const markdown = readFileSync(file, "utf8");
  expect(markdown).toContain("## First\n\n```mermaid\n");
  expect(markdown).toContain("## Second\n\n```mermaid\n");
  expect(markdown.match(/^```mermaid$/gm)).toHaveLength(2);
  expect(readdirSync(output)).toEqual(["example_workspace.md"]);
});

test("JSON reflects removal of the last view", () => {
  const { services, workspace, output } = setup();
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.views.delete(workspace.id, view.id);
  jest.advanceTimersByTime(5000);
  const document = WorkspaceDocumentSchema.parse(
    JSON.parse(readFileSync(join(output, "example_workspace.json"), "utf8")),
  );
  expect(document.views).toEqual([]);
});

test.each(["disabled", "deleted"] as const)(
  "%s workspaces cancel pending JSON updates",
  (action) => {
    const { services, workspace, output } = setup();
    services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
    const file = join(output, "example_workspace.json");
    const initial = readFileSync(file, "utf8");
    services.elements.create(workspace.id, { name: "Pending", kind: "person" });
    if (action === "disabled") {
      services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
    } else {
      services.workspaces.delete(workspace.id);
    }
    jest.advanceTimersByTime(5000);
    expect(readFileSync(file, "utf8")).toBe(initial);
  },
);

test("workspace names that normalize to the same filename retain separate JSON exports", () => {
  const { services, workspace, output } = setup("Shared Workspace");
  const second = services.workspaces.create({ name: "Shared-Workspace" });
  for (const candidate of [workspace, second]) {
    services.workspaces.update(candidate.id, { settings: { automaticExport: "json" } });
    services.views.create(candidate.id, { name: "Runtime", kind: "custom" });
  }
  jest.advanceTimersByTime(5000);
  const files = readdirSync(output);
  expect(files).toHaveLength(2);
  expect(
    files.every((file) => file.startsWith("shared_workspace_") && file.endsWith(".json")),
  ).toBe(true);
  const exportedIds = files.map(
    (file) =>
      WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(join(output, file), "utf8"))).workspace
        .id,
  );
  expect(new Set(exportedIds)).toEqual(new Set([workspace.id, second.id]));
});

test("Mermaid Markdown keeps each view's membership and updates renamed views without duplicates", () => {
  const { services, workspace, output } = setup();
  const first = services.elements.create(workspace.id, {
    name: "First API",
    kind: "softwareSystem",
  }).result;
  const second = services.elements.create(workspace.id, {
    name: "Second API",
    kind: "softwareSystem",
  }).result;
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const firstView = services.views.create(workspace.id, {
    name: "Data Flow",
    kind: "custom",
    elementIds: [first.id],
  }).result;
  services.views.create(workspace.id, {
    name: "Data/Flow",
    kind: "custom",
    elementIds: [second.id],
  });
  jest.advanceTimersByTime(5000);
  const file = join(output, "example_workspace.md");
  const markdown = readFileSync(file, "utf8");
  const blocks = [...markdown.matchAll(/## ([^\n]+)\n\n```mermaid\n([\s\S]*?)\n```/g)];
  expect(blocks).toHaveLength(2);
  const firstBlock = blocks.find((block) => block[1] === "Data Flow")?.[2];
  const secondBlock = blocks.find((block) => block[1] === "Data/Flow")?.[2];
  expect(firstBlock).toContain("First API");
  expect(firstBlock).not.toContain("Second API");
  expect(secondBlock).toContain("Second API");
  expect(secondBlock).not.toContain("First API");
  services.views.update(workspace.id, firstView.id, { name: "Renamed View" });
  jest.advanceTimersByTime(5000);
  const renamed = readFileSync(file, "utf8");
  expect(renamed).toContain("## Renamed View\n");
  expect(renamed).not.toContain("## Data Flow\n");
  expect(renamed.match(/^```mermaid$/gm)).toHaveLength(2);
  expect(readdirSync(output)).toEqual(["example_workspace.md"]);
});

test("long workspace filenames stay bounded and Unicode view names become Markdown headings", () => {
  const { services, workspace, output } = setup("ﬃ".repeat(100));
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  services.views.create(workspace.id, { name: "Д".repeat(180), kind: "custom" });
  jest.advanceTimersByTime(5000);
  const workspaceFile = readdirSync(output)[0];
  expect(workspaceFile).toBeDefined();
  if (!workspaceFile) throw new Error("Missing workspace file");
  expect(workspaceFile).toEndWith(".md");
  expect(Buffer.byteLength(workspaceFile)).toBeLessThanOrEqual(203);
  expect(readFileSync(join(output, workspaceFile), "utf8")).toContain(`## ${"Д".repeat(180)}\n`);
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const document = WorkspaceDocumentSchema.parse(
    JSON.parse(readFileSync(join(output, workspaceFile.replace(/\.md$/, ".json")), "utf8")),
  );
  expect(document.workspace.name).toBe("ﬃ".repeat(100));
  expect(document.views[0]?.name).toBe("Д".repeat(180));
});

test("Mermaid exports use view membership and safe Unicode snake case folders", () => {
  const { services, workspace, output } = setup("../../Мой Workspace");
  const shown = services.elements.create(workspace.id, {
    name: "Shown API",
    kind: "softwareSystem",
  }).result;
  services.elements.create(workspace.id, { name: "Outside View", kind: "softwareSystem" });
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  services.views.create(workspace.id, {
    name: "../API / Runtime",
    kind: "custom",
    elementIds: [shown.id],
    settings: { autoLayoutDirection: "TB" },
  });
  jest.advanceTimersByTime(5000);
  const mermaid = readFileSync(join(output, "мой_workspace.md"), "utf8");
  expect(mermaid).toContain("```mermaid\nflowchart TB\n");
  expect(mermaid).toContain("Shown API");
  expect(mermaid).not.toContain("Outside View");
});

test("MCP batch changes update a single workspace JSON export", () => {
  const { services, workspace, output } = setup();
  services.views.create(workspace.id, { name: "First", kind: "custom" });
  services.views.create(workspace.id, { name: "Second", kind: "custom" });
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.model.applyOperations(
    workspace.id,
    {
      operations: [{ op: "createElement", data: { name: "Via MCP", kind: "person" } }],
    },
    "mcp",
  );
  jest.advanceTimersByTime(4999);
  const file = join(output, "example_workspace.json");
  expect(readFileSync(file, "utf8")).not.toContain("Via MCP");
  jest.advanceTimersByTime(1);
  const document = WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  expect(document.elements[0]?.name).toBe("Via MCP");
  expect(document.views).toHaveLength(2);
  expect(readdirSync(output)).toEqual(["example_workspace.json"]);
});

test("disabling cancels pending exports and re-enabling exports immediately", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const file = join(output, "example_workspace.md");
  const initial = readFileSync(file, "utf8");
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  jest.advanceTimersByTime(1000);
  services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
  jest.advanceTimersByTime(5000);
  expect(readFileSync(file, "utf8")).toBe(initial);
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  expect(readFileSync(file, "utf8")).toContain("```mermaid\nflowchart LR");
  services.views.update(workspace.id, view.id, { settings: { autoLayoutDirection: "TB" } });
  jest.advanceTimersByTime(4999);
  expect(readFileSync(file, "utf8")).toContain("```mermaid\nflowchart LR");
  jest.advanceTimersByTime(1);
  expect(readFileSync(file, "utf8")).toContain("```mermaid\nflowchart TB");
});

test("deleted views are removed from Markdown and deleted workspaces cancel pending updates", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const file = join(output, "example_workspace.md");
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  services.views.delete(workspace.id, view.id);
  jest.advanceTimersByTime(5000);
  const withoutViews = readFileSync(file, "utf8");
  expect(withoutViews).toBe("# Example Workspace\n");
  services.views.create(workspace.id, { name: "Other", kind: "custom" });
  services.workspaces.delete(workspace.id);
  jest.advanceTimersByTime(5000);
  expect(readFileSync(file, "utf8")).toBe(withoutViews);
});

test("imports schedule exports through workspace events", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.views.create(workspace.id, { name: "Runtime", kind: "custom" });
  const document = services.model.getDocument(workspace.id);
  services.imports.importDocument(document, { name: "Imported Workspace" });
  jest.advanceTimersByTime(5000);
  expect(existsSync(join(output, "imported_workspace.json"))).toBe(true);
});

test("filesystem errors do not break mutations and later updates can export", () => {
  const { services, workspace, output } = setup();
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  writeFileSync(output, "blocks directory creation");
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    rmSync(output);
    services.views.update(workspace.id, view.id, { description: "Try again" });
    jest.advanceTimersByTime(5000);
    expect(existsSync(join(output, "example_workspace.json"))).toBe(true);
  } finally {
    warning.mockRestore();
  }
});

test("bootstrap uses the database data directory and database close cancels exports", () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-auto-export-bootstrap-"));
  const context = createAppContext({
    ...loadConfig({ SEED_EXAMPLE: "false" }),
    databasePath: join(directory, "architecture.db"),
  });
  cleanups.push(() => {
    context.database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace = context.services.workspaces.create({ name: "Bootstrap" });
  context.services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const view = context.services.views.create(workspace.id, {
    name: "Runtime",
    kind: "custom",
  }).result;
  jest.advanceTimersByTime(5000);
  const file = join(directory, "auto-exports", "bootstrap.json");
  expect(existsSync(file)).toBe(true);
  rmSync(join(directory, "auto-exports"), { recursive: true });
  context.services.views.update(workspace.id, view.id, { description: "Pending" });
  context.database.close();
  expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
  expect(existsSync(file)).toBe(false);
});
