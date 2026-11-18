/**
 * Optional stdio entry point for MCP clients that cannot speak Streamable HTTP
 * (spec §20). It shares the exact same domain services as the HTTP server.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "@structsmith/mcp";
import { createAppContext } from "./bootstrap";
import { loadConfig } from "./config";

const config = loadConfig();
const ctx = (() => {
  try {
    return createAppContext(config);
  } catch (error) {
    console.error(`[startup] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
})();
const server = createMcpServer({ services: ctx.services, readOnly: config.mcpReadOnly });

const transport = new StdioServerTransport();
const close = () => {
  try {
    ctx.database.close();
  } catch (error) {
    console.error("[shutdown] Could not save workspace JSON:", error);
    process.exitCode = 1;
  }
};
transport.onclose = close;
const shutdown = () => {
  void server
    .close()
    .catch((error: unknown) => {
      console.error("[shutdown] Could not close MCP:", error);
      process.exitCode = 1;
    })
    .finally(close);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("end", shutdown);
try {
  await server.connect(transport);
} catch (error) {
  close();
  throw error;
}
