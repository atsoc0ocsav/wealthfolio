import { reloadAllAddons } from "@/addons/addons-core";
import { updateAddon } from "@/adapters";
import { ExternalLink } from "@/components/external-link";
import { Badge } from "@wealthfolio/ui/components/ui/badge";
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { useToast } from "@wealthfolio/ui/components/ui/use-toast";
import type { AddonUpdateInfo } from "@wealthfolio/addon-sdk";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface AddonUpdateCardProps {
  addonId: string;
  addonName: string;
  updateInfo: AddonUpdateInfo;
  onUpdateComplete?: () => void;
  disabled?: boolean;
}

export function AddonUpdateCard({
  addonId,
  addonName,
  updateInfo,
  onUpdateComplete,
  disabled = false,
}: AddonUpdateCardProps) {
  const { t } = useTranslation();
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();
  const addonDetailUrl = `https://wealthfolio.app/addons/${encodeURIComponent(addonId)}`;

  const handleUpdate = async () => {
    if (!updateInfo.downloadUrl) {
      toast({
        title: t("settings:addon_update_not_available"),
        description: t("settings:addon_update_no_url"),
        variant: "destructive",
      });
      return;
    }

    try {
      setIsUpdating(true);

      await updateAddon(addonId);

      // Reload addons to apply the update
      await reloadAllAddons();

      toast({
        title: t("settings:addon_update_successful"),
        description: t("settings:addon_update_success_message", {
          name: addonName,
          version: updateInfo.latestVersion,
        }),
      });

      onUpdateComplete?.();
    } catch (error) {
      console.error("Error updating addon:", error);
      toast({
        title: t("settings:addon_update_failed"),
        description:
          error instanceof Error ? error.message : t("settings:addon_update_failed_fallback"),
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const getUpdateBadgeVariant = () => {
    if (updateInfo.isCritical) return "destructive";
    if (updateInfo.hasBreakingChanges) return "secondary";
    return "default";
  };

  const getUpdateBadgeText = () => {
    if (updateInfo.isCritical) return t("settings:addon_update_critical");
    if (updateInfo.hasBreakingChanges) return t("settings:addon_update_breaking");
    return null; // Don't show badge for regular updates
  };

  if (!updateInfo.updateAvailable) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Icons.ArrowUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h4 className="font-medium text-amber-900 dark:text-amber-100">
              {t("settings:addon_update_available")}
            </h4>
            {getUpdateBadgeText() && (
              <Badge variant={getUpdateBadgeVariant()} className="text-xs">
                {getUpdateBadgeText()}
              </Badge>
            )}
          </div>

          <div className="text-sm text-amber-800 dark:text-amber-200">
            <p>
              {updateInfo.currentVersion} →{" "}
              <span className="font-medium">{updateInfo.latestVersion}</span>
            </p>
            {updateInfo.releaseDate && (
              <p className="text-xs opacity-80">
                {t("settings:addon_update_released", {
                  date: new Date(updateInfo.releaseDate).toLocaleDateString(),
                })}
              </p>
            )}
          </div>

          {updateInfo.releaseNotes && (
            <p className="line-clamp-2 text-sm text-amber-700 dark:text-amber-300">
              {updateInfo.releaseNotes}
            </p>
          )}
        </div>

        <div className="ml-4 flex items-center gap-2">
          {(updateInfo.releaseNotes || updateInfo.changelogUrl) && (
            <Button variant="ghost" size="sm" asChild>
              <ExternalLink href={addonDetailUrl}>
                <span className="inline-flex items-center">
                  <Icons.FileText className="mr-1 h-3 w-3" />
                  {t("settings:addon_update_release_notes")}
                </span>
              </ExternalLink>
            </Button>
          )}

          <Button onClick={handleUpdate} disabled={isUpdating || disabled} size="sm">
            {isUpdating ? (
              <>
                <Icons.Loader className="mr-1 h-3 w-3 animate-spin" />
                {t("settings:addon_update_updating")}
              </>
            ) : (
              <>
                <Icons.Download className="mr-1 h-3 w-3" />
                {t("settings:addon_update_update_button")}
              </>
            )}
          </Button>
        </div>
      </div>

      {updateInfo.minWealthfolioVersion && (
        <div className="mt-3 rounded-md bg-amber-100 p-2 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            <Icons.Info className="mr-1 inline h-3 w-3" />
            {t("settings:addon_update_requires", { version: updateInfo.minWealthfolioVersion })}
          </p>
        </div>
      )}
    </div>
  );
}
