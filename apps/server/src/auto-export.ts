import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DomainEvent, type Services, toMermaid } from "@structsmith/domain";

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

function exportName(target: NamedTarget, peers: readonly NamedTarget[]): string {
  const base = baseName(target);
  const collision = peers.some((peer) => peer.id !== target.id && baseName(peer) === base);
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

const markdownHeading = (name: string): string =>
  name.replace(/\s+/g, " ").replace(/[\\`*_{}[\]<>#]/g, "\\$&");

export class AutoExportScheduler {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly services: Services,
    private readonly directory: string,
  ) {
    this.unsubscribe = services.context.bus.subscribe((event) => this.onChange(event));
  }

  private cancel(workspaceId: string): void {
    clearTimeout(this.pending.get(workspaceId));
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
      this.export(event.workspaceId);
    } else if (event.type === "workspace.changed") {
      this.schedule(event.workspaceId);
    }
  }

  private schedule(workspaceId: string): void {
    this.cancel(workspaceId);
    const timer = setTimeout(() => {
      this.pending.delete(workspaceId);
      this.export(workspaceId);
    }, 5000);
    timer.unref();
    this.pending.set(workspaceId, timer);
  }

  private export(workspaceId: string): void {
    try {
      const document = this.services.model.getDocument(workspaceId);
      const format = document.workspace.settings.automaticExport;
      if (format === "disabled") return;
      const workspaceName = exportName(document.workspace, this.services.workspaces.list());
      const extension = format === "json" ? "json" : "md";
      const content =
        format === "json"
          ? JSON.stringify(document, null, 2)
          : [
              `# ${markdownHeading(document.workspace.name)}`,
              ...document.views.map(
                (view) =>
                  `## ${markdownHeading(view.name)}\n\n\`\`\`mermaid\n${toMermaid(document, {
                    view,
                    direction: view.settings.autoLayoutDirection,
                  })}\n\`\`\``,
              ),
            ].join("\n\n");
      mkdirSync(this.directory, { recursive: true });
      writeFileSync(join(this.directory, `${workspaceName}.${extension}`), `${content}\n`);
    } catch (error) {
      console.warn(`[auto-export] could not export "${workspaceId}":`, error);
    }
  }

  close(): void {
    this.unsubscribe();
    for (const workspaceId of this.pending.keys()) this.cancel(workspaceId);
  }
}
