import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const entrypoint of ["apps/server/src/index.ts", "apps/server/src/mcp-stdio.ts"]) {
  test(`${entrypoint} logs invalid JSON and exits before accepting clients`, () => {
    const directory = mkdtempSync(join(tmpdir(), "structsmith-startup-error-"));
    const sources = join(directory, "workspaces");
    mkdirSync(sources);
    const file = join(sources, "broken.json");
    writeFileSync(file, "{broken");
    try {
      const result = Bun.spawnSync([process.execPath, entrypoint], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          WORKSPACE_FILES_DIR: sources,
          PORT: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 5000,
      });
      const stderr = new TextDecoder().decode(result.stderr);
      expect(result.exitCode).toBe(1);
      expect(stderr).toContain("[startup]");
      expect(stderr).toContain(file);
      expect(stderr).toContain("Cannot load workspace JSON");
      expect(new TextDecoder().decode(result.stdout)).not.toContain("REST API");
      expect(readFileSync(file, "utf8")).toBe("{broken");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
