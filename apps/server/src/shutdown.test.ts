import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
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
      WORKSPACE_FILES_DIR: directory,
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
    const documents = readWorkspaceDocuments(directory);
    expect(documents[0]?.workspace.id).toBe(workspace.id);
    expect(documents[0]?.workspace.name).toBe("Before exit");
  } finally {
    abort.abort();
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);

test("MCP stdio flushes a pending mutation when the client closes stdin", async () => {
  const directory = mkdtempSync(join(tmpdir(), "structsmith-mcp-shutdown-"));
  const child = Bun.spawn([process.execPath, "apps/server/src/mcp-stdio.ts"], {
    cwd: rootDir,
    env: { ...process.env, WORKSPACE_FILES_DIR: directory, MCP_READ_ONLY: "false" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 4000,
  });
  const replies = child.stdout.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const receive = async () => {
    while (!pending.includes("\n")) {
      const chunk = await replies.read();
      if (chunk.done) throw new Error("MCP stdio closed before replying");
      pending += decoder.decode(chunk.value, { stream: true });
    }
    const end = pending.indexOf("\n");
    const reply = JSON.parse(pending.slice(0, end));
    pending = pending.slice(end + 1);
    return reply;
  };
  const send = (message: object) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "shutdown-test", version: "1" },
      },
    });
    expect(await receive()).toHaveProperty("result.protocolVersion");
    send({ method: "notifications/initialized" });
    send({
      id: 2,
      method: "tools/call",
      params: { name: "workspace_create", arguments: { id: "before-eof", name: "Before EOF" } },
    });
    const created = await receive();
    expect(created).toMatchObject({ id: 2, result: { content: expect.any(Array) } });
    expect(created.result.isError).not.toBe(true);
    expect(existsSync(join(directory, "before-eof.json"))).toBe(false);

    child.stdin.end();
    expect(await child.exited).toBe(0);
    expect(readWorkspaceDocuments(directory)[0]?.workspace.name).toBe("Before EOF");
  } finally {
    replies.releaseLock();
    child.kill();
    await child.exited;
    rmSync(directory, { recursive: true, force: true });
  }
});
