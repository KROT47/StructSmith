import { afterEach, expect, test } from "bun:test";
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
import { createDatabase, DrizzleStore, runMigrations } from "@structsmith/database";
import { createServices, InMemoryEventBus } from "@structsmith/domain";
import { createAppContext } from "./bootstrap";
import { loadConfig } from "./config";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-rebuild-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    ...loadConfig({ SEED_EXAMPLE: "false" }),
    databasePath: join(directory, "architecture.db"),
    workspaceFilesDir: join(directory, "workspaces"),
  };
  return { directory, config };
}

function workspaceFile(directory: string) {
  const filename = readdirSync(directory).find((file) => file.endsWith(".json"));
  if (!filename) throw new Error("Missing workspace JSON");
  return join(directory, filename);
}

test("startup rebuild preserves native IDs and document metadata and resets activity and snapshots", () => {
  const { config } = setup();
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
        data: { name: "Context", kind: "custom", elementIds: ["@person", "@api"] },
      },
    ],
  });
  const document = first.services.model.getDocument(workspace.id);
  expect(first.services.snapshots.list(workspace.id)).not.toBeEmpty();
  first.database.close();

  const second = createAppContext(config);
  try {
    expect(second.services.model.getDocument(workspace.id)).toEqual(document);
    expect(second.services.activity.list(workspace.id)).toEqual([]);
    expect(second.services.snapshots.list(workspace.id)).toEqual([]);
  } finally {
    second.database.close();
  }
});

test("JSON changes replace SQLite data and removing all files yields an empty database", () => {
  const { config } = setup();
  const first = createAppContext(config);
  const workspace = first.services.workspaces.create({ name: "Original" });
  first.database.close();
  const file = workspaceFile(config.workspaceFilesDir);
  const document = JSON.parse(readFileSync(file, "utf8"));
  document.workspace.name = "From Git";
  writeFileSync(file, JSON.stringify(document));
  const second = createAppContext(config);
  expect(second.services.workspaces.get(workspace.id).name).toBe("From Git");
  second.database.close();
  for (const filename of readdirSync(config.workspaceFilesDir))
    rmSync(join(config.workspaceFilesDir, filename));
  const third = createAppContext(config);
  try {
    expect(third.services.workspaces.list()).toEqual([]);
  } finally {
    third.database.close();
  }
});

test("invalid JSON or invalid references abort startup without replacing the old database or source file", () => {
  const { config } = setup();
  const first = createAppContext(config);
  const workspace = first.services.workspaces.create({ name: "Preserved" });
  first.database.close();
  const before = readFileSync(config.databasePath);
  const file = workspaceFile(config.workspaceFilesDir);
  const document = JSON.parse(readFileSync(file, "utf8"));
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
    expect(readFileSync(config.databasePath)).toEqual(before);
    expect(readFileSync(file, "utf8")).toBe(source);
    expect(existsSync(`${config.databasePath}.lock`)).toBe(false);
  }
});

test("an existing SQLite is exported once when the workspace directory has never existed", () => {
  const { config } = setup();
  const old = createDatabase(config.databasePath);
  runMigrations(old.sqlite, config.migrationsDir);
  const services = createServices(new DrizzleStore(old.db), new InMemoryEventBus());
  const workspace = services.workspaces.create({ name: "Before JSON" });
  services.elements.create(workspace.id, { name: "Preserved API", kind: "softwareSystem" });
  const expected = services.model.getDocument(workspace.id);
  old.close();
  const context = createAppContext(config);
  try {
    expect(context.services.model.getDocument(workspace.id)).toEqual(expected);
    expect(JSON.parse(readFileSync(workspaceFile(config.workspaceFilesDir), "utf8"))).toEqual(
      expected,
    );
  } finally {
    context.database.close();
  }
});

test("another running owner cannot rebuild an open database and a stale lock is recovered", () => {
  const { config } = setup();
  const first = createAppContext(config);
  try {
    expect(() => {
      createAppContext(config);
    }).toThrow("already in use");
  } finally {
    first.database.close();
  }
  writeFileSync(`${config.databasePath}.lock`, JSON.stringify({ pid: 2147483647, token: "stale" }));
  const restarted = createAppContext(config);
  restarted.database.close();
  expect(existsSync(`${config.databasePath}.lock`)).toBe(false);
});

test("an empty managed directory stays empty even with example seeding enabled", () => {
  const { config } = setup();
  mkdirSync(config.workspaceFilesDir);
  const context = createAppContext({ ...config, seedExample: true });
  try {
    expect(context.services.workspaces.list()).toEqual([]);
  } finally {
    context.database.close();
  }
});

test("WORKSPACE_FILES_DIR is resolved without changing the default location beside SQLite", () => {
  expect(loadConfig({ WORKSPACE_FILES_DIR: "architecture" }).workspaceFilesDir).toEndWith(
    "/StructSmith/architecture",
  );
  expect(loadConfig({}).workspaceFilesDir).toBeUndefined();
});

test("a removed JSON directory never re-adopts the previous SQLite after initialization", () => {
  const { config } = setup();
  const first = createAppContext({ ...config, seedExample: true });
  expect(first.services.workspaces.list()).not.toBeEmpty();
  first.services.workspaces.create({ name: "Removed in Git" });
  first.database.close();
  rmSync(config.workspaceFilesDir, { recursive: true });

  const second = createAppContext({ ...config, seedExample: true });
  try {
    expect(second.services.workspaces.list()).toEqual([]);
    expect(readdirSync(config.workspaceFilesDir)).toEqual([]);
  } finally {
    second.database.close();
  }
});

test("changing the JSON directory uses the new source without adopting unrelated SQLite", () => {
  const { directory, config } = setup();
  const first = createAppContext(config);
  first.services.workspaces.create({ name: "Old source" });
  first.database.close();
  const newDirectory = join(directory, "new-branch-workspaces");

  const second = createAppContext({ ...config, workspaceFilesDir: newDirectory });
  try {
    expect(second.services.workspaces.list()).toEqual([]);
    expect(readdirSync(newDirectory)).toEqual([]);
  } finally {
    second.database.close();
  }
});

test("an abandoned recovery guard blocks startup without deleting either lock", () => {
  const { config } = setup();
  const first = createAppContext(config);
  first.services.workspaces.create({ name: "Safe while recovering" });
  first.database.close();
  const before = readFileSync(config.databasePath);
  const lockPath = `${config.databasePath}.lock`;
  const recoveryPath = `${lockPath}.recovery`;
  const staleOwner = JSON.stringify({ pid: 2147483647, token: "stale" });
  writeFileSync(lockPath, staleOwner);
  writeFileSync(recoveryPath, "abandoned recovery");
  expect(() => {
    createAppContext(config);
  }).toThrow(recoveryPath);
  expect(readFileSync(lockPath, "utf8")).toBe(staleOwner);
  expect(readFileSync(recoveryPath, "utf8")).toBe("abandoned recovery");
  expect(readFileSync(config.databasePath)).toEqual(before);
  rmSync(recoveryPath);
  const next = createAppContext(config);
  next.database.close();
  expect(existsSync(recoveryPath)).toBe(false);
});

test("simultaneous startups recovering one stale owner admit exactly one process", async () => {
  const { directory, config } = setup();
  writeFileSync(`${config.databasePath}.lock`, JSON.stringify({ pid: 2147483647, token: "stale" }));
  const start = join(directory, "start");
  const release = join(directory, "release");
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
       while(!existsSync(${JSON.stringify(release)})) await Bun.sleep(5);
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
      ...children.map((child) => child.exited),
      Bun.sleep(2000).then(() => {
        throw new Error("Both processes acquired the stale owner lock");
      }),
    ]);
    expect(loser).toBe(2);
  } finally {
    writeFileSync(release, "release");
    const statuses = await Promise.all(children.map((child) => child.exited));
    expect(statuses.toSorted()).toEqual([0, 2]);
  }
  expect(existsSync(`${config.databasePath}.lock`)).toBe(false);
  expect(existsSync(`${config.databasePath}.lock.recovery`)).toBe(false);
});
