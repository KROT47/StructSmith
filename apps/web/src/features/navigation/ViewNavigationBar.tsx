import type { ArchitectureElement, ArchitectureView } from "@structsmith/contracts";
import { ArrowLeft, ChevronRight, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function ViewNavigationBar({
  current,
  elements,
  ancestors,
  onUp,
  onEditView,
}: {
  current: ArchitectureView | null;
  elements: readonly ArchitectureElement[];
  ancestors: readonly ArchitectureView[];
  onUp: (viewId: string) => void;
  onEditView: () => void;
}) {
  const { t } = useTranslation();
  const parent = ancestors.at(-1);
  const scope: string[] = [];
  const seen = new Set<string>();
  let scopeElement = elements.find((element) => element.id === current?.scopeElementId);
  while (scopeElement && !seen.has(scopeElement.id)) {
    seen.add(scopeElement.id);
    scope.unshift(scopeElement.name);
    const parentId = scopeElement.parentId;
    scopeElement = elements.find((element) => element.id === parentId);
  }
  return (
    <nav
      aria-label={t("navigation.title")}
      className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2"
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={!parent}
        onClick={() => parent && onUp(parent.id)}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("navigation.back")}
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-xs">
        {ancestors.map((view) => (
          <span key={view.id} className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="max-w-40 truncate rounded px-1 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onUp(view.id)}
              title={view.name}
            >
              {view.name}
            </button>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </span>
        ))}
        <span aria-current="page" className="shrink-0 font-medium">
          {current?.name}
        </span>
        {current && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label={t("inspector.viewSettings")}
            title={t("inspector.viewSettings")}
            onClick={onEditView}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {scope.length > 0 && (
        <span
          className="max-w-[35%] truncate text-[11px] text-muted-foreground"
          title={scope.join(" / ")}
        >
          {scope.join(" / ")}
        </span>
      )}
    </nav>
  );
}
