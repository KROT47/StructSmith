import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootDir } from "./config";
import { readWorkspaceDocuments } from "./workspace-files";

test("HTTP shutdown flushes pending JSON even when an SSE client keeps its connection open", async () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-shutdown-"));
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing reserved port");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = Bun.spawn([process.execPath, "apps/server/src/index.ts"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATABASE_PATH: join(directory, "cache.db"),
      SEED_EXAMPLE: "false",
      AGENT_CHAT_ENABLED: "false",
      AUTH_MODE: "none",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const url = `http://127.0.0.1:${port}`;
  const abort = new AbortController();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        ready = (await fetch(`${url}/health`)).ok;
      } catch {
        /* still starting */
      }
      if (ready) break;
      await Bun.sleep(20);
    }
    expect(ready).toBe(true);
    const response = await fetch(`${url}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Before exit" }),
    });
    const workspace = (await response.json()) as { id: string };
    expect(response.status).toBe(201);
    const events = await fetch(`${url}/api/events?workspaceId=${workspace.id}`, {
      signal: abort.signal,
    });
    expect(events.status).toBe(200);
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    abort.abort();
    const documents = readWorkspaceDocuments(join(directory, "auto-exports"));
    expect(documents[0]?.workspace.id).toBe(workspace.id);
    expect(documents[0]?.workspace.name).toBe("Before exit");
    expect(readdirSync(directory)).not.toContain("cache.db.lock");
    expect(readFileSync(join(directory, "cache.db.json-source"), "utf8")).toContain("auto-exports");
  } finally {
    abort.abort();
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
