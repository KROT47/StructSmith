import { lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { AUTO_EXPORT_DELAY_MS, ERROR_CODES, type WorkspaceDocument } from "@structsmith/contracts";
import { DomainError, type DomainEvent, type Services, toMermaid } from "@structsmith/domain";
import { writeWorkspaceFile } from "./workspace-files";

const markdownHeading = (name: string): string =>
  name.replace(/\s+/g, " ").replace(/[\\`*_{}[\]<>#]/g, "\\$&");

function exportMermaid(jsonPath: string, workspaceId: string, document?: WorkspaceDocument): void {
  const path = jsonPath.replace(/\.json$/, ".md");
  const marker = `<!-- StructSmith Mermaid workspace: ${workspaceId} -->\n`;
  try {
    const existing = lstatSync(path, { throwIfNoEntry: false });
    const owned = existing?.isFile() && readFileSync(path, "utf8").startsWith(marker);
    if (document?.workspace.settings.automaticExport !== "mermaid") {
      if (owned) rmSync(path, { force: true });
      return;
    }
    if (existing && !owned) {
      throw new Error("The destination already contains a user file.");
    }
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
    writeWorkspaceFile(path, `${marker}${markdown}\n`);
  } catch (error) {
    console.error(`[workspace-files] Could not update Mermaid export "${path}":`, error);
  }
}

export class AutoExportScheduler {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(
    private readonly services: Services,
    private readonly directory: string,
    private readonly files: Map<string, string>,
  ) {
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

  private export(workspaceId: string): void {
    const existing = this.files.get(workspaceId);
    let document: WorkspaceDocument;
    try {
      document = this.services.model.getDocument(workspaceId);
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== ERROR_CODES.WORKSPACE_NOT_FOUND) {
        throw error;
      }
      if (existing) {
        rmSync(existing, { force: true });
        exportMermaid(existing, workspaceId);
        this.files.delete(workspaceId);
      }
      return;
    }

    const jsonPath = existing ?? join(this.directory, `${workspaceId}.json`);
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeWorkspaceFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`);
    this.files.set(workspaceId, jsonPath);
    exportMermaid(jsonPath, workspaceId, document);
  }

  flush(): void {
    const failures: Error[] = [];
    for (const workspaceId of this.pending.keys()) {
      try {
        this.export(workspaceId);
        this.cancel(workspaceId);
      } catch (error) {
        failures.push(new Error(`Could not save workspace "${workspaceId}"`, { cause: error }));
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Could not save all workspace JSON in "${this.directory}".`,
      );
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
