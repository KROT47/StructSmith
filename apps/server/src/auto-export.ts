import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DomainEvent, Services } from "@structsmith/domain";

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

const baseFolder = (target: NamedTarget): string =>
  snakeCase(target.name) || snakeCase(target.id) || "untitled";

function folderName(target: NamedTarget, peers: readonly NamedTarget[]): string {
  const base = baseFolder(target);
  const collision = peers.some((peer) => peer.id !== target.id && baseFolder(peer) === base);
  if (!collision && Buffer.byteLength(base) <= 200) return base;

  const suffix = `_${createHash("sha256").update(target.id).digest("hex").slice(0, 12)}`;
  let prefix = "";
  let bytes = 0;
  for (const character of base) {
    bytes += Buffer.byteLength(character);
    if (bytes > 200 - suffix.length) break;
    prefix += character;
  }
  return `${prefix.replace(/_+$/g, "")}${suffix}`;
}

export class AutoExportScheduler {
  private readonly pending = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly services: Services,
    private readonly directory: string,
  ) {
    this.unsubscribe = services.context.bus.subscribe((event) => this.onChange(event));
  }

  private cancel(workspaceId: string): void {
    for (const timer of this.pending.get(workspaceId)?.values() ?? []) clearTimeout(timer);
    this.pending.delete(workspaceId);
  }

  private onChange(event: DomainEvent): void {
    if (event.type === "workspace.deleted") {
      this.cancel(event.workspaceId);
      return;
    }

    const workspace = this.services.workspaces.get(event.workspaceId);
    if (workspace.settings.automaticExport === "disabled") {
      this.cancel(event.workspaceId);
      return;
    }

    if (event.type === "workspace.settings.changed") {
      this.cancel(event.workspaceId);
      for (const view of this.services.views.list(event.workspaceId)) {
        this.export(event.workspaceId, view.id);
      }
    } else if (event.type === "view.changed") {
      this.schedule(event.workspaceId, event.viewId);
    } else if (
      event.type === "model.changed" ||
      (event.type === "workspace.changed" && event.source === "import")
    ) {
      for (const view of this.services.views.list(event.workspaceId)) {
        this.schedule(event.workspaceId, view.id);
      }
    }
  }

  private schedule(workspaceId: string, viewId: string): void {
    let views = this.pending.get(workspaceId);
    if (!views) {
      views = new Map();
      this.pending.set(workspaceId, views);
    }
    clearTimeout(views.get(viewId));
    const timer = setTimeout(() => {
      views.delete(viewId);
      if (views.size === 0) this.pending.delete(workspaceId);
      this.export(workspaceId, viewId);
    }, 5000);
    timer.unref();
    views.set(viewId, timer);
  }

  private export(workspaceId: string, viewId: string): void {
    try {
      const document = this.services.model.getDocument(workspaceId);
      const format = document.workspace.settings.automaticExport;
      const view = document.views.find((candidate) => candidate.id === viewId);
      if (format === "disabled" || !view) return;

      const directory = join(
        this.directory,
        folderName(document.workspace, this.services.workspaces.list()),
      );
      const filename = folderName(view, document.views);
      mkdirSync(directory, { recursive: true });
      if (format === "json") {
        writeFileSync(
          join(directory, `${filename}.json`),
          `${JSON.stringify(document, null, 2)}\n`,
        );
      } else {
        writeFileSync(
          join(directory, `${filename}.mmd`),
          `${this.services.model.exportMermaid(workspaceId, viewId)}\n`,
        );
      }
    } catch (error) {
      console.warn(`[auto-export] could not export view "${viewId}":`, error);
    }
  }

  close(): void {
    this.unsubscribe();
    for (const workspaceId of this.pending.keys()) this.cancel(workspaceId);
  }
}
