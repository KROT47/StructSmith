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
    return createAppContext({ ...config, seedExample: false });
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
process.on("SIGINT", () => void server.close().finally(close));
process.on("SIGTERM", () => void server.close().finally(close));
await server.connect(transport);
