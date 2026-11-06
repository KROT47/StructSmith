import type { ArchitectureElement, ArchitectureView } from "@structsmith/contracts";
import { detailViewKind, detailViewsFor } from "@structsmith/domain";
import { ArrowDownRight, Plus } from "lucide-react";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DetailNavigation {
  elements: readonly ArchitectureElement[];
  views: readonly ArchitectureView[];
  currentViewId: string | null;
  enabled: boolean;
  openDetails: (elementId: string) => void;
}

export const DetailNavigationContext = createContext<DetailNavigation | null>(null);

export function useDetailNavigation(elementId?: string) {
  const context = useContext(DetailNavigationContext);
  const element = context?.elements.find((item) => item.id === elementId);
  const kind = element ? detailViewKind(element) : null;
  const candidates =
    element && context ? detailViewsFor(element, context.views, context.currentViewId) : [];
  const alreadyInside = context?.views.some(
    (view) =>
      view.id === context.currentViewId && view.scopeElementId === elementId && view.kind === kind,
  );
  return {
    available: Boolean(element && kind && (!alreadyInside || candidates.length > 0)),
    count: candidates.length,
    enabled: context?.enabled ?? false,
    open: () => elementId && context?.openDetails(elementId),
  };
}

export function DetailViewAction({
  elementId,
  compact = false,
}: {
  elementId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const navigation = useDetailNavigation(elementId);
  if (!navigation.available) return null;
  const linked = navigation.count > 0;
  const label = t(linked ? "navigation.openDetails" : "navigation.createDetails");
  const Icon = linked ? ArrowDownRight : Plus;
  return (
    <Button
      type="button"
      size={compact ? "iconSm" : "sm"}
      variant="ghost"
      data-detail-state={linked ? "linked" : "empty"}
      className={cn(
        "nodrag nopan shrink-0 border normal-case tracking-normal",
        linked
          ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary"
          : "border-dashed border-muted-foreground/40 text-muted-foreground hover:text-foreground",
      )}
      aria-label={label}
      title={
        linked ? t("navigation.openHint", { count: navigation.count }) : t("navigation.createHint")
      }
      disabled={!navigation.enabled}
      onClick={(event) => {
        event.stopPropagation();
        navigation.open();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Icon className="h-3.5 w-3.5" />
      {!compact && label}
    </Button>
  );
}
