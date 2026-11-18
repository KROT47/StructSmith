import { createApp } from "./app";
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
const { app, mcp, agents } = createApp(ctx);

const server = app.listen(config.port, config.host, (error) => {
  if (error) {
    console.error("[server] unable to start:", error);
    ctx.database.close();
    process.exitCode = 1;
    return;
  }
  const base = `http://localhost:${config.port}`;
  console.log(`\n  ${config.productName} v${config.version}`);
  console.log(
    `  UI        ${ctx.config.webDistDir ? base : "http://localhost:5173 (vite dev server)"}`,
  );
  console.log(`  REST API  ${base}/api`);
  console.log(
    `  MCP       ${base}/mcp  (streamable http${config.mcpReadOnly ? ", read-only" : ""})`,
  );
  console.log(`  Health    ${base}/health`);
  console.log(`  Workspaces  ${config.workspaceFilesDir}\n`);
});

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] ${signal} received, shutting down.`);
  await mcp.closeAll().catch(() => undefined);
  await agents?.close().catch(() => undefined);
  const finish = () => {
    try {
      ctx.database.close();
      process.exit(0);
    } catch (error) {
      console.error("[shutdown] Could not save workspace JSON:", error);
      process.exit(1);
    }
  };
  server.close(finish);
  // SSE connections may outlive the grace period; flush exports on this path too.
  setTimeout(finish, 3000).unref();
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
