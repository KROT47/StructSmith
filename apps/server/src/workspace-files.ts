import { randomUUID } from "node:crypto";
import {
  closeSync,
  type Dirent,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { type WorkspaceDocument, WorkspaceDocumentSchema } from "@structsmith/contracts";

interface WorkspaceFile {
  path: string;
  document: WorkspaceDocument;
}

const stagedName = /^\.structsmith-rename-[a-z0-9_-]{1,64}\.tmp$/;

function canonicalPath({ path, document }: WorkspaceFile): string {
  return join(dirname(path), `${document.workspace.id}.json`);
}

function stagingPath({ path, document }: WorkspaceFile): string {
  return join(dirname(path), `.structsmith-rename-${document.workspace.id}.tmp`);
}

export function readWorkspaceFiles(directory: string): WorkspaceFile[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readWorkspaceFiles(path);
      const staged = stagedName.test(entry.name);
      if (!entry.isFile() || (!/\.json$/i.test(entry.name) && !staged)) return [];
      try {
        const document = WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(path, "utf8")));
        const file = { path, document };
        if (staged && path !== stagingPath(file)) {
          throw new Error(
            `Workspace ID "${document.workspace.id}" does not match the staged filename.`,
          );
        }
        return [file];
      } catch (error) {
        throw new Error(
          `Cannot load workspace JSON "${path}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
}

function sourcePriority(file: WorkspaceFile): number {
  if (file.path === canonicalPath(file)) return 2;
  if (file.path === stagingPath(file)) return 1;
  return 0;
}

export function uniqueWorkspaceFiles(files: readonly WorkspaceFile[]): WorkspaceFile[] {
  const workspaces = new Map<string, WorkspaceFile>();
  for (const file of files) {
    const previous = workspaces.get(file.document.workspace.id);
    if (previous && !isDeepStrictEqual(previous.document, file.document)) {
      throw new Error(
        `Conflicting JSON exports for workspace "${file.document.workspace.id}": "${previous.path}" and "${file.path}".`,
      );
    }
    if (!previous || sourcePriority(file) > sourcePriority(previous)) {
      workspaces.set(file.document.workspace.id, file);
    }
  }
  return [...workspaces.values()];
}

export function readWorkspaceDocuments(directory: string): WorkspaceDocument[] {
  return uniqueWorkspaceFiles(readWorkspaceFiles(directory)).map(({ document }) => document);
}

function assertVacant(path: string, vacated: ReadonlySet<string>): void {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry || vacated.has(path)) return;
  // A case-only rename on a case-insensitive volume may refer to a known input.
  for (const source of vacated) {
    if (source.toLowerCase() !== path.toLowerCase()) continue;
    const from = lstatSync(source);
    if (from.dev === entry.dev && from.ino === entry.ino) return;
  }
  throw new Error(`Cannot rename workspace JSON to "${path}": destination is occupied.`);
}

/** Call after validating all documents, while holding the workspace directory lock. */
export function normalizeWorkspaceFiles(files: readonly WorkspaceFile[]): Map<string, string> {
  const sources = uniqueWorkspaceFiles(files);
  const retained = new Set(sources.map(({ path }) => path));
  const duplicates = files.filter(({ path }) => !retained.has(path));
  const moves = sources
    .map((file) => ({ source: file.path, staged: stagingPath(file), target: canonicalPath(file) }))
    .filter(({ source, target }) => source !== target);
  const vacated = new Set([
    ...duplicates.map(({ path }) => path),
    ...moves.map(({ source }) => source),
  ]);
  const unoccupied = new Set<string>();
  for (const { source, staged, target } of moves) {
    if (source !== staged) assertVacant(staged, unoccupied);
    assertVacant(target, vacated);
  }

  for (const { path } of duplicates) rmSync(path);
  // Vacate every original filename before publishing any destination. Staged
  // JSON keeps its identity and folder, so the next startup can resume either phase.
  for (const { source, staged } of moves) {
    if (source === staged) continue;
    assertVacant(staged, unoccupied);
    renameSync(source, staged);
  }
  for (const { staged, target } of moves) {
    assertVacant(target, unoccupied);
    renameSync(staged, target);
  }
  return new Map(sources.map((file) => [file.document.workspace.id, canonicalPath(file)]));
}

/** Publish a complete document so Git never reads a partially written export. */
export function writeWorkspaceFile(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
