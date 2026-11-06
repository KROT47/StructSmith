import type {
  ArchitectureBoundary,
  ArchitectureElement,
  ArchitectureRecord,
  ArchitectureView,
  ViewDetail,
} from "@structsmith/contracts";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ExplorerTab, useEditorStore } from "@/store/editor";
import { ModelTree } from "./ModelTree";
import { PresalesPanel } from "./PresalesPanel";
import { ViewsPanel } from "./ViewsPanel";

interface ExplorerProps {
  workspaceId: string;
  elements: readonly ArchitectureElement[];
  boundaries: readonly ArchitectureBoundary[];
  views: readonly ArchitectureView[];
  records: readonly ArchitectureRecord[];
  view: ViewDetail | null;
  activeViewId: string | null;
  onSelectView: (viewId: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Explorer(props: ExplorerProps) {
  const { t } = useTranslation();
  const tab = useEditorStore((state) => state.explorerTab);
  const setTab = useEditorStore((state) => state.setExplorerTab);
  const collapseLabel = t(props.collapsed ? "explorer.expand" : "explorer.collapse");

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as ExplorerTab)}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
    >
      <div
        className={cn(
          "flex h-8 shrink-0 items-center border-b border-border",
          props.collapsed ? "justify-center px-1" : "pr-1",
        )}
      >
        {!props.collapsed && (
          <TabsList className="min-w-0 flex-1 border-b-0">
            <TabsTrigger value="views">{t("explorer.views")}</TabsTrigger>
            <TabsTrigger value="model">{t("explorer.model")}</TabsTrigger>
            <TabsTrigger value="presales">{t("explorer.presales")}</TabsTrigger>
          </TabsList>
        )}
        <Tooltip label={collapseLabel} side="right">
          <Button
            type="button"
            size="iconSm"
            variant="ghost"
            className="h-6 w-6 shrink-0 cursor-pointer"
            aria-expanded={!props.collapsed}
            aria-label={collapseLabel}
            onClick={props.onToggleCollapse}
          >
            {props.collapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </Button>
        </Tooltip>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", props.collapsed && "hidden")}>
        <TabsContent value="views" className="min-h-0">
          <ViewsPanel
            workspaceId={props.workspaceId}
            views={props.views}
            elements={props.elements}
            activeViewId={props.activeViewId}
            onSelectView={props.onSelectView}
          />
        </TabsContent>
        <TabsContent value="model" className="min-h-0">
          <ModelTree
            workspaceId={props.workspaceId}
            elements={props.elements}
            boundaries={props.boundaries}
            view={props.view}
          />
        </TabsContent>
        <TabsContent value="presales" className="min-h-0">
          <PresalesPanel
            workspaceId={props.workspaceId}
            records={props.records}
            elements={props.elements}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}
