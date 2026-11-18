import type { Workspace, WorkspaceDocument } from "@structsmith/contracts";
import {
  ImportMermaidRequestSchema,
  WorkspaceDocumentSchema,
  WorkspaceIdSchema,
} from "@structsmith/contracts";
import { assertWorkspaceNameAvailable, requireWorkspace, type ServiceContext } from "../context";
import { badRequest, DomainError } from "../errors";
import { createId, nowIso } from "../ids";
import { parseMermaidToWorkspaceDocument } from "../mermaid-import";
import { wouldCreateCycle } from "../rules";
import { insertDocumentContents, restoreDocument } from "./snapshot.service";

function checkDocumentReferences(document: WorkspaceDocument): void {
  const elements = new Set(document.elements.map((element) => element.id));
  const relationships = new Set(document.relationships.map((relationship) => relationship.id));
  const views = new Set(document.views.map((view) => view.id));
  const boundaries = document.views.flatMap((view) => view.boundaries);
  const allBoundaries = boundaries.length > 0 ? boundaries : (document.boundaries ?? []);
  const boundaryIds = new Set(allBoundaries.map((boundary) => boundary.id));
  const parentByElement = new Map(
    document.elements.map((element) => [element.id, element.parentId]),
  );
  const parentByBoundary = new Map(
    allBoundaries.map((boundary) => [boundary.id, boundary.parentBoundaryId]),
  );
  const requireReference = (valid: boolean): void => {
    if (!valid) throw badRequest(`Invalid references in workspace "${document.workspace.id}".`);
  };
  for (const entity of [
    ...document.elements,
    ...document.relationships,
    ...document.views,
    ...allBoundaries,
    ...document.records,
  ]) {
    requireReference(entity.workspaceId === document.workspace.id);
  }
  for (const element of document.elements) {
    requireReference(element.parentId === null || elements.has(element.parentId));
    requireReference(
      !wouldCreateCycle(element.id, element.parentId, (id) => parentByElement.get(id)),
    );
  }
  for (const relationship of document.relationships) {
    requireReference(
      elements.has(relationship.sourceElementId) && elements.has(relationship.targetElementId),
    );
  }
  for (const view of document.views) {
    requireReference(view.scopeElementId === null || elements.has(view.scopeElementId));
    requireReference(
      new Set(view.elements.map((entry) => entry.elementId)).size === view.elements.length,
    );
    requireReference(
      new Set(view.relationships.map((entry) => entry.relationshipId)).size ===
        view.relationships.length,
    );
    for (const entry of view.elements) {
      requireReference(entry.viewId === view.id && elements.has(entry.elementId));
    }
    for (const entry of view.relationships) {
      requireReference(entry.viewId === view.id && relationships.has(entry.relationshipId));
    }
    for (const boundary of view.boundaries) requireReference(boundary.viewId === view.id);
  }
  for (const boundary of allBoundaries) {
    requireReference(views.has(boundary.viewId));
    requireReference(
      boundary.parentBoundaryId === null || boundaryIds.has(boundary.parentBoundaryId),
    );
    requireReference(
      !wouldCreateCycle(boundary.id, boundary.parentBoundaryId, (id) => parentByBoundary.get(id)),
    );
    for (const elementId of boundary.elementIds) requireReference(elements.has(elementId));
  }
  for (const record of document.records) {
    for (const elementId of record.linkedElementIds) requireReference(elements.has(elementId));
  }
}

const restoreError = (document: WorkspaceDocument, error: unknown): DomainError =>
  Object.assign(
    badRequest(
      `Could not restore workspace "${document.workspace.id}" (${document.workspace.name}): ${error instanceof Error ? error.message : String(error)}`,
    ),
    { workspaceId: document.workspace.id },
  );

/** Shared import domain layer for native JSON and Mermaid (REST and MCP). */
export class ImportService {
  constructor(private readonly ctx: ServiceContext) {}

  /** Rebuild startup state without changing identities or creating session history. */
  restoreDocuments(input: readonly WorkspaceDocument[]): void {
    const documents = input.map((document) => {
      try {
        const parsed = WorkspaceDocumentSchema.parse(document);
        checkDocumentReferences(parsed);
        return parsed;
      } catch (error) {
        throw restoreError(document, error);
      }
    });
    this.ctx.store.transaction((repos) => {
      for (const workspace of repos.workspaces.list()) repos.workspaces.delete(workspace.id);
      for (const document of documents) {
        try {
          repos.workspaces.insert(document.workspace);
          insertDocumentContents(repos, document);
        } catch (error) {
          throw restoreError(document, error);
        }
      }
    });
  }

  importDocument(
    document: WorkspaceDocument,
    options: { mode?: "new" | "overwrite"; name?: string } = {},
  ): Workspace {
    WorkspaceIdSchema.parse(document.workspace.id);
    checkDocumentReferences(document);
    const mode = options.mode ?? "new";
    const timestamp = nowIso();

    const workspace = this.ctx.store.transaction((repos) => {
      if (mode === "overwrite") {
        const existing = requireWorkspace(repos, document.workspace.id);
        assertWorkspaceNameAvailable(repos, options.name ?? document.workspace.name, existing.id);
        restoreDocument(repos, document);
        const next: Workspace = {
          ...existing,
          name: options.name ?? document.workspace.name,
          description: document.workspace.description,
          mode: document.workspace.mode,
          settings: document.workspace.settings,
          revision: existing.revision + 1,
          updatedAt: timestamp,
        };
        repos.workspaces.update(next);
        repos.activity.insert({
          workspaceId: next.id,
          source: "import",
          message: "Imported workspace (overwrite)",
          createdAt: timestamp,
        });
        return next;
      }

      assertWorkspaceNameAvailable(repos, options.name ?? document.workspace.name);
      const newId = createId(options.name ?? document.workspace.name);
      const idMap = new Map<string, string>();
      const mapId = (oldId: string): string => {
        const mapped = idMap.get(oldId);
        if (mapped) return mapped;
        const created = createId(oldId);
        idMap.set(oldId, created);
        return created;
      };

      const next: Workspace = {
        id: newId,
        name: options.name ?? document.workspace.name,
        description: document.workspace.description,
        mode: document.workspace.mode,
        settings: document.workspace.settings,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      repos.workspaces.insert(next);

      const remapped: WorkspaceDocument = {
        formatVersion: 1,
        workspace: next,
        elements: document.elements.map((element) => ({
          ...element,
          id: mapId(element.id),
          workspaceId: newId,
          parentId: element.parentId ? mapId(element.parentId) : null,
        })),
        boundaries: (document.boundaries ?? []).flatMap((boundary) => {
          const ownerViewId = boundary.viewId ?? document.views[0]?.id;
          return ownerViewId
            ? [
                {
                  ...boundary,
                  id: mapId(boundary.id),
                  workspaceId: newId,
                  viewId: mapId(ownerViewId),
                  parentBoundaryId: boundary.parentBoundaryId
                    ? mapId(boundary.parentBoundaryId)
                    : null,
                  elementIds: boundary.elementIds.map(mapId),
                },
              ]
            : [];
        }),
        relationships: document.relationships.map((relationship) => ({
          ...relationship,
          id: mapId(relationship.id),
          workspaceId: newId,
          sourceElementId: mapId(relationship.sourceElementId),
          targetElementId: mapId(relationship.targetElementId),
        })),
        views: document.views.map((view) => {
          const viewId = mapId(view.id);
          return {
            ...view,
            id: viewId,
            workspaceId: newId,
            scopeElementId: view.scopeElementId ? mapId(view.scopeElementId) : null,
            elements: view.elements.map((entry) => ({
              ...entry,
              viewId,
              elementId: mapId(entry.elementId),
            })),
            relationships: view.relationships.map((entry) => ({
              ...entry,
              viewId,
              relationshipId: mapId(entry.relationshipId),
            })),
            boundaries: (view.boundaries ?? []).map((boundary) => ({
              ...boundary,
              id: mapId(boundary.id),
              workspaceId: newId,
              viewId,
              parentBoundaryId: boundary.parentBoundaryId ? mapId(boundary.parentBoundaryId) : null,
              elementIds: boundary.elementIds.map(mapId),
            })),
          };
        }),
        records: document.records.map((record) => ({
          ...record,
          id: mapId(record.id),
          workspaceId: newId,
          linkedElementIds: record.linkedElementIds.map(mapId),
        })),
      };

      insertDocumentContents(repos, remapped);
      repos.activity.insert({
        workspaceId: newId,
        source: "import",
        message: "Imported workspace",
        createdAt: timestamp,
      });
      return next;
    });

    this.ctx.bus.emit({
      type: "workspace.changed",
      workspaceId: workspace.id,
      revision: workspace.revision,
      source: "import",
      message: "Workspace imported",
    });
    return workspace;
  }

  importMermaid(
    source: string,
    options: { mode?: "new" | "overwrite"; name?: string; workspaceId?: string } = {},
  ): Workspace {
    if (options.mode === "overwrite" && !options.workspaceId) {
      throw badRequest("workspaceId is required when importing in overwrite mode.");
    }

    let document: WorkspaceDocument;
    try {
      const request = ImportMermaidRequestSchema.parse({ ...options, source });
      document = parseMermaidToWorkspaceDocument(request.source, {
        workspaceName: request.name,
        workspaceId: request.workspaceId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      if (error instanceof Error) {
        throw badRequest(`Invalid Mermaid source: ${error.message}`);
      }
      throw error;
    }
    // Persistence errors must retain their real cause, not become syntax errors.
    return this.importDocument(document, { mode: options.mode });
  }
}
