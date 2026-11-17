import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AUTO_EXPORT_DELAY_MS } from "@structsmith/contracts";
import { type DomainEvent, type Services, toMermaid } from "@structsmith/domain";
import { readWorkspaceFiles, writeWorkspaceFile } from "./workspace-files";

function snakeCase(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1_$2")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

interface NamedTarget {
  id: string;
  name: string;
}

const baseName = (target: NamedTarget): string =>
  snakeCase(target.name) || snakeCase(target.id) || "untitled";

function exportName(target: NamedTarget): string {
  const base = baseName(target);
  let prefix = "";
  let bytes = 0;
  for (const character of base) {
    bytes += Buffer.byteLength(character);
    if (bytes > 200) break;
    prefix += character;
  }
  return prefix.replace(/_+$/g, "");
}

const markdownHeading = (name: string): string =>
  name.replace(/\s+/g, " ").replace(/[\\`*_{}[\]<>#]/g, "\\$&");

export class AutoExportScheduler {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly files = new Map<string, Set<string>>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly services: Services,
    private readonly directory: string,
  ) {
    for (const { path, document } of readWorkspaceFiles(directory)) {
      const files = this.files.get(document.workspace.id) ?? new Set<string>();
      files.add(path);
      this.files.set(document.workspace.id, files);
    }
    this.unsubscribe = services.context.bus.subscribe((event) => this.onChange(event));
  }

  private cancel(workspaceId: string): void {
    clearTimeout(this.pending.get(workspaceId));
    this.pending.delete(workspaceId);
  }

  private onChange(event: DomainEvent): void {
    if (event.type === "workspace.deleted" || event.type === "workspace.settings.changed") {
      this.cancel(event.workspaceId);
      this.tryExport(event.workspaceId);
    } else if (event.type === "workspace.changed") {
      this.schedule(event.workspaceId);
    }
  }

  private schedule(workspaceId: string): void {
    this.cancel(workspaceId);
    const timer = setTimeout(() => {
      this.pending.delete(workspaceId);
      this.tryExport(workspaceId);
    }, AUTO_EXPORT_DELAY_MS);
    timer.unref();
    this.pending.set(workspaceId, timer);
  }

  private tryExport(workspaceId: string): void {
    try {
      this.export(workspaceId);
    } catch (error) {
      console.error(
        `[workspace-files] Could not save workspace "${workspaceId}" in "${this.directory}"; retrying in ${AUTO_EXPORT_DELAY_MS / 1000} seconds:`,
        error,
      );
      this.schedule(workspaceId);
    }
  }

  private removeFiles(workspaceId: string, keep?: string): void {
    for (const path of this.files.get(workspaceId) ?? []) {
      if (path === keep || !existsSync(path)) continue;
      // A rename may have reassigned this path to another workspace already.
      const owner = JSON.parse(readFileSync(path, "utf8")) as { workspace: { id: string } };
      if (owner.workspace.id !== workspaceId) continue;
      rmSync(path, { force: true });
      rmSync(path.replace(/\.json$/, ".md"), { force: true });
    }
    if (keep) this.files.set(workspaceId, new Set([keep]));
    else this.files.delete(workspaceId);
  }

  private export(workspaceId: string): void {
    const workspaces = this.services.workspaces.list();
    if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
      this.removeFiles(workspaceId);
      return;
    }
    const document = this.services.model.getDocument(workspaceId);
    const workspaceName = exportName(document.workspace);
    const jsonPath = join(this.directory, `${workspaceName}.json`);
    const markdownPath = join(this.directory, `${workspaceName}.md`);
    mkdirSync(this.directory, { recursive: true });
    writeWorkspaceFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
    const files = this.files.get(workspaceId) ?? new Set<string>();
    files.add(jsonPath);
    this.files.set(workspaceId, files);
    if (document.workspace.settings.automaticExport === "mermaid") {
      const markdown = [
        `# ${markdownHeading(document.workspace.name)}`,
        ...document.views.map(
          (view) =>
            `## ${markdownHeading(view.name)}\n\n\`\`\`mermaid\n${toMermaid(document, {
              view,
              direction: view.settings.autoLayoutDirection,
            })}\n\`\`\``,
        ),
      ].join("\n\n");
      writeWorkspaceFile(markdownPath, `${markdown}\n`);
    } else {
      rmSync(markdownPath, { force: true });
    }
    this.removeFiles(workspaceId, jsonPath);
  }

  exportAll(): void {
    for (const workspace of this.services.workspaces.list()) {
      this.export(workspace.id);
      this.cancel(workspace.id);
    }
  }

  flush(): void {
    for (const workspaceId of this.pending.keys()) {
      this.export(workspaceId);
      this.cancel(workspaceId);
    }
  }

  close(): void {
    if (this.closed) return;
    this.unsubscribe();
    try {
      this.flush();
    } finally {
      this.closed = true;
      for (const workspaceId of this.pending.keys()) this.cancel(workspaceId);
    }
  }
}
