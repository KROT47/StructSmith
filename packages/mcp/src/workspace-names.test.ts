import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTestContext } from "../../../tests/helpers";
import { createMcpServer } from "./server";

test("MCP rejects duplicate workspace names without creating another workspace", async () => {
  const { services, close } = createTestContext();
  const server = createMcpServer({ services, readOnly: false });
  const client = new Client({ name: "workspace-names-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const created = await client.callTool({
      name: "workspace_create",
      arguments: { name: "MCP workspace" },
    });
    expect(created.isError).not.toBe(true);
    const originalWorkspaces = services.workspaces.list();
    expect(originalWorkspaces).toHaveLength(1);

    const duplicate = await client.callTool({
      name: "workspace_create",
      arguments: { name: "  MCP WORKSPACE  " },
    });
    expect(duplicate.isError).toBe(true);
    expect(services.workspaces.list()).toEqual(originalWorkspaces);
  } finally {
    await client.close();
    await server.close();
    close();
  }
});
