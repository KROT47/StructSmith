# JSON workspace storage implementation plan

> **For agentic workers:** Use the existing shared checkout and independent tasks below. Preserve pre-existing export changes.

**Goal:** Rebuild SQLite from authoritative JSON on every startup, preserving IDs; always save JSON and optionally export Mermaid via a switch.

**Architecture:** Reuse domain restore logic in a transaction in a newly built SQLite file before accepting requests. JSON files contain one complete workspace each; SQLite history is disposable. Keep the existing five-second export delay, atomic file replacement, and flush pending writes on clean shutdown.

**Tech Stack:** Bun, SQLite, Drizzle, Zod, React, shared Radix Switch. No new dependencies.

**Spec:** User's implementation request in this chat and agreed startup reset behavior.

## Constraints

- Preserve workspace/entity IDs, revision, timestamps, layout and settings on startup.
- Reset activity and snapshots. Reject invalid sources without replacing a working database.
- JSON is mandatory for all workspaces, including those without views. Mermaid is disabled or enabled.
- Retain existing Mermaid Markdown output. Normalize legacy JSON export setting to disabled.
- Keep files beside SQLite under auto-exports by default; allow WORKSPACE_FILES_DIR and make default JSON files trackable in Git.
- Avoid resetting a database already used by another process; HTTP MCP shares the server.

## Tasks

- [x] Domain: implement restoreDocuments, test exact round-trip, reset, rollback and ownership.
- [x] UI/contracts: disabled|mermaid setting, legacy input compatibility, shared switch and translated copy; update contract tests.
- [x] Export: mandatory JSON, atomic replacement, rename/delete cleanup, shutdown flush; tests for debounce, disabled Mermaid, collisions, failure retry, and all mutations.
- [x] Startup: build fresh SQLite from validated files, first-run adoption of legacy DB, single-writer guard and reset tests.
- [x] Integrate entrypoint shutdown, configuration, Git/Docker paths and documentation.
- [x] Run check, typecheck, tests, web build; review complete diff and inspect toggle visually.

## Review focus

- Duplicate IDs and bad references must not leave partial rebuilt state.
- Deleting or renaming a workspace must not resurrect an old JSON file on restart.
- Shutdown must not discard changes inside the export delay.
- A second stdio/server process must not replace a live cache.
- Existing databases without exports require a first-run conversion before reset.

## Validation

Biome, TypeScript and production web build pass. Full suite: 254 passing tests, including real HTTP shutdown with an SSE client held open. UI switch checked in the browser, including saving and reopening.
