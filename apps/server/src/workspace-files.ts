import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
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

export function readWorkspaceFiles(
  directory: string,
): { path: string; document: WorkspaceDocument }[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return readWorkspaceFiles(path);
      if (!entry.isFile() || !entry.name.endsWith(".json")) return [];
      try {
        return [
          {
            path,
            document: WorkspaceDocumentSchema.parse(JSON.parse(readFileSync(path, "utf8"))),
          },
        ];
      } catch (error) {
        throw new Error(
          `Cannot load workspace JSON "${path}": ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
}

export function readWorkspaceDocuments(directory: string): WorkspaceDocument[] {
  const workspaces = new Map<string, { path: string; document: WorkspaceDocument }>();
  for (const file of readWorkspaceFiles(directory)) {
    const previous = workspaces.get(file.document.workspace.id);
    if (previous && !isDeepStrictEqual(previous.document, file.document)) {
      throw new Error(
        `Conflicting JSON exports for workspace "${file.document.workspace.id}": "${previous.path}" and "${file.path}".`,
      );
    }
    if (!previous) workspaces.set(file.document.workspace.id, file);
  }
  return [...workspaces.values()].map(({ document }) => document);
}

/** Publish a complete document so Git never reads a partially written export. */
export function writeWorkspaceFile(path: string, content: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, "wx", 0o600);
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
