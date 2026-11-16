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
  "saving %s settings exports every existing view immediately, including repeated saves",
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
    const extension = automaticExport === "json" ? "json" : "mmd";
    const directory = join(output, "example_workspace");
    expect(readdirSync(directory)).toEqual([`first_view.${extension}`, `second_view.${extension}`]);
    const file = join(directory, `first_view.${extension}`);
    expect(readFileSync(file, "utf8")).toContain("Before save");

    services.elements.update(workspace.id, element.id, { name: "After save" });
    expect(readFileSync(file, "utf8")).not.toContain("After save");
    services.workspaces.update(workspace.id, { settings: { automaticExport } });
    expect(readFileSync(file, "utf8")).toContain("After save");
  },
);

test("JSON exports wait five seconds after the latest view update and contain current layout", () => {
  const { services, workspace, output } = setup("APIWorkspace Demo");
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const element = services.elements.create(workspace.id, {
    name: "API",
    kind: "softwareSystem",
  }).result;
  const view = services.views.create(workspace.id, {
    name: "Runtime View",
    kind: "custom",
    elementIds: [element.id],
  }).result;
  const file = join(output, "api_workspace_demo", "runtime_view.json");
  jest.advanceTimersByTime(4999);
  expect(existsSync(file)).toBe(false);
  services.views.saveLayout(workspace.id, view.id, [{ elementId: element.id, x: 42, y: 25 }]);
  jest.advanceTimersByTime(4999);
  expect(existsSync(file)).toBe(false);
  jest.advanceTimersByTime(1);
  const document = WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  expect(document.workspace.name).toBe("APIWorkspace Demo");
  expect(document.elements[0]?.name).toBe("API");
  expect(document.views[0]?.elements[0]).toMatchObject({ x: 42, y: 25 });
  expect(readdirSync(join(output, "api_workspace_demo"))).toEqual(["runtime_view.json"]);
});

test("different views use independent debounce timers", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.views.create(workspace.id, { name: "First", kind: "custom" });
  jest.advanceTimersByTime(1000);
  services.views.create(workspace.id, { name: "Second", kind: "custom" });
  jest.advanceTimersByTime(4000);
  expect(existsSync(join(output, "example_workspace", "first.json"))).toBe(true);
  expect(existsSync(join(output, "example_workspace", "second.json"))).toBe(false);
  jest.advanceTimersByTime(1000);
  expect(existsSync(join(output, "example_workspace", "second.json"))).toBe(true);
});

test("workspace names that normalize to the same folder retain separate exports", () => {
  const { services, workspace, output } = setup("Shared Workspace");
  const second = services.workspaces.create({ name: "Shared-Workspace" });
  for (const candidate of [workspace, second]) {
    services.workspaces.update(candidate.id, { settings: { automaticExport: "json" } });
    services.views.create(candidate.id, { name: "Runtime", kind: "custom" });
  }
  jest.advanceTimersByTime(5000);
  const folders = readdirSync(output);
  expect(folders).toHaveLength(2);
  expect(folders.every((folder) => folder.startsWith("shared_workspace_"))).toBe(true);
  const exportedIds = folders.map(
    (folder) =>
      WorkspaceDocumentSchema.parse(
        JSON.parse(readFileSync(join(output, folder, "runtime.json"), "utf8")),
      ).workspace.id,
  );
  expect(new Set(exportedIds)).toEqual(new Set([workspace.id, second.id]));
});

test("view names that normalize to the same filename retain separate Mermaid diagrams", () => {
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
  const directory = join(output, "example_workspace");
  const files = readdirSync(directory);
  expect(files).toHaveLength(2);
  expect(files.every((file) => file.startsWith("data_flow_") && file.endsWith(".mmd"))).toBe(true);
  const diagrams = files.map((file) => readFileSync(join(directory, file), "utf8"));
  expect(diagrams.filter((diagram) => diagram.includes("First API"))).toHaveLength(1);
  expect(diagrams.filter((diagram) => diagram.includes("Second API"))).toHaveLength(1);
  services.views.update(workspace.id, firstView.id, { description: "Another update" });
  jest.advanceTimersByTime(5000);
  expect(readdirSync(directory)).toEqual(files);
});

test("long normalized workspace and Unicode view names fit filesystem name limits", () => {
  const { services, workspace, output } = setup("ﬃ".repeat(100));
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.views.create(workspace.id, { name: "Д".repeat(180), kind: "custom" });
  jest.advanceTimersByTime(5000);
  const workspaceFolder = readdirSync(output)[0];
  expect(workspaceFolder).toBeDefined();
  if (!workspaceFolder) throw new Error("Missing workspace folder");
  expect(Buffer.byteLength(workspaceFolder)).toBeLessThanOrEqual(200);
  const viewFile = readdirSync(join(output, workspaceFolder))[0];
  expect(viewFile).toBeDefined();
  if (!viewFile) throw new Error("Missing view file");
  expect(viewFile).toEndWith(".json");
  expect(Buffer.byteLength(viewFile)).toBeLessThanOrEqual(205);
  const document = WorkspaceDocumentSchema.parse(
    JSON.parse(readFileSync(join(output, workspaceFolder, viewFile), "utf8")),
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
  const mermaid = readFileSync(join(output, "мой_workspace", "api_runtime.mmd"), "utf8");
  expect(mermaid).toStartWith("flowchart TB");
  expect(mermaid).toContain("Shown API");
  expect(mermaid).not.toContain("Outside View");
});

test("MCP batch changes export all existing views even without view.changed events", () => {
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
  expect(readFileSync(join(output, "example_workspace", "first.json"), "utf8")).not.toContain(
    "Via MCP",
  );
  jest.advanceTimersByTime(1);
  for (const view of ["first", "second"]) {
    const document = WorkspaceDocumentSchema.parse(
      JSON.parse(readFileSync(join(output, "example_workspace", `${view}.json`), "utf8")),
    );
    expect(document.elements[0]?.name).toBe("Via MCP");
  }
});

test("disabling cancels pending exports and re-enabling exports immediately", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  jest.advanceTimersByTime(1000);
  services.workspaces.update(workspace.id, { settings: { automaticExport: "disabled" } });
  jest.advanceTimersByTime(5000);
  expect(existsSync(output)).toBe(false);
  services.workspaces.update(workspace.id, { settings: { automaticExport: "mermaid" } });
  const file = join(output, "example_workspace", "runtime.mmd");
  expect(readFileSync(file, "utf8")).toStartWith("flowchart LR");
  services.views.update(workspace.id, view.id, { settings: { autoLayoutDirection: "TB" } });
  jest.advanceTimersByTime(4999);
  expect(readFileSync(file, "utf8")).toStartWith("flowchart LR");
  jest.advanceTimersByTime(1);
  expect(readFileSync(file, "utf8")).toStartWith("flowchart TB");
});

test("deleted views and workspaces never produce delayed exports", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  services.views.delete(workspace.id, view.id);
  jest.advanceTimersByTime(5000);
  expect(existsSync(output)).toBe(false);
  services.views.create(workspace.id, { name: "Other", kind: "custom" });
  services.workspaces.delete(workspace.id);
  jest.advanceTimersByTime(5000);
  expect(existsSync(output)).toBe(false);
});

test("imports schedule exports through workspace events", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  services.views.create(workspace.id, { name: "Runtime", kind: "custom" });
  const document = services.model.getDocument(workspace.id);
  services.imports.importDocument(document, { name: "Imported Workspace" });
  jest.advanceTimersByTime(5000);
  expect(existsSync(join(output, "imported_workspace", "runtime.json"))).toBe(true);
});

test("filesystem errors do not break mutations and later updates can export", () => {
  const { services, workspace, output } = setup();
  services.workspaces.update(workspace.id, { settings: { automaticExport: "json" } });
  const view = services.views.create(workspace.id, { name: "Runtime", kind: "custom" }).result;
  writeFileSync(output, "blocks directory creation");
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
    rmSync(output);
    services.views.update(workspace.id, view.id, { description: "Try again" });
    jest.advanceTimersByTime(5000);
    expect(existsSync(join(output, "example_workspace", "runtime.json"))).toBe(true);
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
  const file = join(directory, "auto-exports", "bootstrap", "runtime.json");
  expect(existsSync(file)).toBe(true);
  rmSync(join(directory, "auto-exports"), { recursive: true });
  context.services.views.update(workspace.id, view.id, { description: "Pending" });
  context.database.close();
  expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
  expect(existsSync(file)).toBe(false);
});
