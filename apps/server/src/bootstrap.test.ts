import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppContext } from "./bootstrap";
import { loadConfig } from "./config";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-rebuild-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = loadConfig({ WORKSPACE_FILES_DIR: join(directory, "workspaces") });
  return { directory, config };
}

test("JSON startup preserves native IDs and document metadata and resets session history", () => {
  const { directory, config } = setup();
  const first = createAppContext(config);
  const workspace = first.services.workspaces.create({ name: "Rebuilt" });
  first.services.model.applyOperations(workspace.id, {
    operations: [
      { op: "createElement", ref: "person", data: { name: "Customer", kind: "person" } },
      { op: "createElement", ref: "api", data: { name: "Portal", kind: "softwareSystem" } },
      {
        op: "createRelationship",
        data: { sourceElementId: "@person", targetElementId: "@api", interactionStyle: "sync" },
      },
      {
        op: "createView",
        ref: "context",
        data: { name: "Context", kind: "custom", elementIds: ["@person", "@api"] },
      },
      { op: "setLayout", viewId: "@context", entries: [{ elementId: "@api", x: 42, y: 84 }] },
    ],
  });
  first.services.workspaces.create({ id: "another", name: "Another" });
  const document = first.services.model.getDocument(workspace.id);
  expect(first.services.snapshots.list(workspace.id)).not.toBeEmpty();
  first.database.close();

  expect(readdirSync(directory)).toEqual(["workspaces"]);
  const second = createAppContext(config);
  try {
    expect(second.services.workspaces.list()).toHaveLength(2);
    expect(second.services.model.getDocument(workspace.id)).toEqual(document);
    expect(second.services.activity.list(workspace.id)).toEqual([]);
    expect(second.services.snapshots.list(workspace.id)).toEqual([]);
  } finally {
    second.database.close();
  }
});

test("JSON edits and deletions determine the next session model", () => {
  const { config } = setup();
  const first = createAppContext(config);
  const workspace = first.services.workspaces.create({ name: "Original" });
  first.database.close();
  const file = join(config.workspaceFilesDir, `${workspace.id}.json`);
  const document = JSON.parse(readFileSync(file, "utf8"));
  document.workspace.name = "From Git";
  writeFileSync(file, JSON.stringify(document));
  const second = createAppContext(config);
  expect(second.services.workspaces.get(workspace.id).name).toBe("From Git");
  second.database.close();
  rmSync(file);
  const third = createAppContext(config);
  try {
    expect(third.services.workspaces.list()).toEqual([]);
  } finally {
    third.database.close();
  }
});

test("invalid sources abort before normalizing any JSON filename", () => {
  const { config } = setup();
  const first = createAppContext(config);
  const workspace = first.services.workspaces.create({ name: "Preserved" });
  first.database.close();
  const file = join(config.workspaceFilesDir, `${workspace.id}.json`);
  const document = JSON.parse(readFileSync(file, "utf8"));
  const unrelated = join(config.workspaceFilesDir, "arbitrary.json");
  const valid = JSON.stringify({
    ...document,
    workspace: { ...document.workspace, id: "untouched", name: "Untouched" },
  });
  writeFileSync(unrelated, valid);
  for (const source of [
    "{broken",
    JSON.stringify({
      ...document,
      relationships: [
        {
          id: "bad",
          workspaceId: workspace.id,
          sourceElementId: "missing",
          targetElementId: "missing",
          description: null,
          technology: null,
          interactionStyle: "sync",
          tags: [],
          properties: {},
          createdAt: document.workspace.createdAt,
          updatedAt: document.workspace.updatedAt,
        },
      ],
    }),
  ]) {
    writeFileSync(file, source);
    expect(() => {
      createAppContext(config);
    }).toThrow(file);
    expect(readFileSync(unrelated, "utf8")).toBe(valid);
    expect(existsSync(join(config.workspaceFilesDir, "untouched.json"))).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(source);
  }
});

test("another context cannot use an open workspace directory until its owner exits", () => {
  const { config } = setup();
  const first = createAppContext(config);
  try {
    expect(() => {
      createAppContext(config);
    }).toThrow("already in use");
  } finally {
    first.database.close();
  }
  const restarted = createAppContext(config);
  restarted.database.close();
});

test("the default workspace directory is data/workspaces", () => {
  expect(loadConfig({}).workspaceFilesDir).toEndWith("/data/workspaces");
  expect(loadConfig({ WORKSPACE_FILES_DIR: "" }).workspaceFilesDir).toEndWith("/data/workspaces");
  expect(loadConfig({ WORKSPACE_FILES_DIR: "architecture" }).workspaceFilesDir).toEndWith(
    "/architecture",
  );
});

test("a fresh start creates an empty model even beside a previous database file", () => {
  const { directory, config } = setup();
  const dbPath = join(directory, "architecture.db");
  writeFileSync(dbPath, "leave this file intact");
  const context = createAppContext(config);
  try {
    expect(context.services.workspaces.list()).toEqual([]);
    expect(readFileSync(dbPath, "utf8")).toBe("leave this file intact");
    expect(readdirSync(config.workspaceFilesDir)).toEqual([".structsmith"]);
    expect(readdirSync(join(config.workspaceFilesDir, ".structsmith"))).toContain("lock.sqlite");
  } finally {
    context.database.close();
  }
});

test("simultaneous startups admit one process and SIGKILL releases its lock", async () => {
  const { directory, config } = setup();
  const start = join(directory, "start");
  const ready = [join(directory, "ready-0"), join(directory, "ready-1")];
  const children = ready.map((readyPath) =>
    Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {existsSync,writeFileSync} from 'node:fs';
     import {createAppContext} from ${JSON.stringify(new URL("./bootstrap.ts", import.meta.url).pathname)};
     writeFileSync(${JSON.stringify(readyPath)}, 'ready');
     while(!existsSync(${JSON.stringify(start)})) await Bun.sleep(5);
     try {
       const context = createAppContext(${JSON.stringify(config)});
       await Bun.sleep(10_000);
       context.database.close();
     } catch(error) {
       console.error(error.message);
       process.exitCode = 2;
     }`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    ),
  );
  try {
    for (let i = 0; !ready.every((path) => existsSync(path)); i++) {
      if (i > 400) throw new Error("Children did not reach startup barrier");
      await Bun.sleep(5);
    }
    writeFileSync(start, "start");
    const loser = await Promise.race([
      ...children.map(async (child) => ({ child, code: await child.exited })),
      Bun.sleep(2000).then(() => {
        throw new Error("Both processes acquired the workspace lock");
      }),
    ]);
    expect(loser.code).toBe(2);
    expect(await new Response(loser.child.stderr).text()).toContain("already in use");
    const winner = children.find((child) => child !== loser.child);
    if (!winner) throw new Error("Missing database owner process");
    winner.kill("SIGKILL");
    expect(await winner.exited).toBe(137);
    createAppContext(config).database.close();
  } finally {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(children.map((child) => child.exited));
  }
});
