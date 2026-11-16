import {
  type AutomaticExport,
  AutomaticExportSchema,
  type Workspace,
} from "@structsmith/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApiErrorHandler } from "@/hooks/useApi";
import { api } from "@/lib/api";
import { invalidateWorkspace } from "@/lib/query";

export function WorkspaceSettingsDialog({
  workspace,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const onError = useApiErrorHandler();
  const [automaticExport, setAutomaticExport] = useState<AutomaticExport>(
    workspace.settings.automaticExport,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateWorkspace(workspace.id, { settings: { automaticExport } });
      invalidateWorkspace(workspace.id);
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="w-[calc(100%-2rem)]" hideClose={saving}>
        <DialogHeader>
          <DialogTitle>{t("workspaceSettings.title")}</DialogTitle>
          <DialogDescription>{workspace.name}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) void save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="workspace-automatic-export">
              {t("workspaceSettings.automaticExport")}
            </Label>
            <Select
              value={automaticExport}
              onValueChange={(value) => setAutomaticExport(AutomaticExportSchema.parse(value))}
              disabled={saving}
            >
              <SelectTrigger
                id="workspace-automatic-export"
                aria-describedby="automatic-export-hint"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AutomaticExportSchema.options.map((format) => (
                  <SelectItem key={format} value={format}>
                    {t(`workspaceSettings.${format}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="automatic-export-hint" className="text-xs text-muted-foreground">
              {t("workspaceSettings.automaticExportHint")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
