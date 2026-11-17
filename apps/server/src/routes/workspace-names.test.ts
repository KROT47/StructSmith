import { expect, test } from "bun:test";
import { once } from "node:events";
import { ApiErrorSchema, WorkspaceSchema } from "@structsmith/contracts";
import express from "express";
import { createTestContext } from "../../../../tests/helpers";
import { errorMiddleware } from "../http-errors";
import { workspaceRoutes } from "./workspaces";

test("REST rejects duplicate workspace names without creating another workspace", async () => {
  const { services, close } = createTestContext();
  const app = express();
  app.use(express.json());
  app.use("/api", workspaceRoutes(services));
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const endpoint = `http://127.0.0.1:${address.port}/api/workspaces`;
    const post = (name: string) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    const created = await post("REST workspace");
    expect(created.status).toBe(201);
    const workspace = WorkspaceSchema.parse(await created.json());

    const duplicate = await post("  REST WORKSPACE  ");
    expect(duplicate.status).toBe(409);
    expect(ApiErrorSchema.parse(await duplicate.json()).error.code).toBe("WORKSPACE_NAME_TAKEN");
    expect(services.workspaces.list()).toEqual([workspace]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    close();
  }
});
