import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schemaFile = new URL("../packages/database/src/schema.sql", import.meta.url);
const result = Bun.spawnSync(["drizzle-kit", "export"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stderr: "inherit",
});
if (result.exitCode !== 0) process.exit(result.exitCode);

const generated = `-- Generated from schema.ts with bun run db:schema.\n${result.stdout.toString().trimEnd()}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(schemaFile) || readFileSync(schemaFile, "utf8") !== generated) {
    console.error("Generated SQLite schema is out of date. Run bun run db:schema.");
    process.exitCode = 1;
  }
} else {
  writeFileSync(schemaFile, generated);
}
