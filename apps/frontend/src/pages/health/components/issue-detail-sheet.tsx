import type { HealthCategory, HealthIssue, HealthSeverity } from "@/lib/types";
import {
  ActionConfirm,
  Badge,
  Button,
  Icons,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@wealthfolio/ui";
import { cn } from "@wealthfolio/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface IssueDetailSheetProps {
  issue: HealthIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onFix: () => void;
  isDismissing: boolean;
  isFixing: boolean;
}

const SEVERITY_CONFIG: Record<HealthSeverity, { labelKey: string; color: string }> = {
  INFO: { labelKey: "health:severity.info", color: "text-muted-foreground" },
  WARNING: { labelKey: "health:severity.warning", color: "text-yellow-600 dark:text-yellow-400" },
  ERROR: { labelKey: "health:severity.error", color: "text-destructive" },
  CRITICAL: { labelKey: "health:severity.critical", color: "text-destructive" },
};

const CATEGORY_LABEL_KEYS: Record<HealthCategory, { labelKey: string; descriptionKey: string }> = {
  PRICE_STALENESS: {
    labelKey: "health:detail.categories.priceStaleness.label",
    descriptionKey: "health:detail.categories.priceStaleness.description",
  },
  FX_INTEGRITY: {
    labelKey: "health:detail.categories.fxIntegrity.label",
    descriptionKey: "health:detail.categories.fxIntegrity.description",
  },
  CLASSIFICATION: {
    labelKey: "health:detail.categories.classification.label",
    descriptionKey: "health:detail.categories.classification.description",
  },
  DATA_CONSISTENCY: {
    labelKey: "health:detail.categories.dataConsistency.label",
    descriptionKey: "health:detail.categories.dataConsistency.description",
  },
  ACCOUNT_CONFIGURATION: {
    labelKey: "health:detail.categories.accountConfiguration.label",
    descriptionKey: "health:detail.categories.accountConfiguration.description",
  },
  SETTINGS_CONFIGURATION: {
    labelKey: "health:detail.categories.settingsConfiguration.label",
    descriptionKey: "health:detail.categories.settingsConfiguration.description",
  },
};

function getCategoryConfigKeysForIssue(issue: HealthIssue): {
  labelKey: string;
  descriptionKey: string;
} {
  if (issue.category !== "SETTINGS_CONFIGURATION") {
    return CATEGORY_LABEL_KEYS[issue.category];
  }

  if (issue.id.startsWith("timezone_missing:")) {
    return {
      labelKey: "health:detail.categories.timezoneMissing.label",
      descriptionKey: "health:detail.categories.timezoneMissing.description",
    };
  }

  if (issue.id.startsWith("timezone_invalid:")) {
    return {
      labelKey: "health:detail.categories.timezoneInvalid.label",
      descriptionKey: "health:detail.categories.timezoneInvalid.description",
    };
  }

  if (issue.id.startsWith("timezone_mismatch:")) {
    return {
      labelKey: "health:detail.categories.timezoneMismatch.label",
      descriptionKey: "health:detail.categories.timezoneMismatch.description",
    };
  }

  return CATEGORY_LABEL_KEYS.SETTINGS_CONFIGURATION;
}

function buildNavigateActionRoute(
  navigateAction: HealthIssue["navigateAction"],
  queryOverrides: Record<string, string> = {},
): string | null {
  if (!navigateAction) return null;

  const query = new URLSearchParams(
    Object.entries({ ...(navigateAction.query ?? {}), ...queryOverrides }).map(([key, value]) => [
      key,
      String(value),
    ]),
  ).toString();

  return `${navigateAction.route}${query ? `?${query}` : ""}`;
}

function getDetailDate(lines: string[]): string | null {
  const dateLine = lines.find((line) => line.startsWith("Date:"));
  const match = dateLine?.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function IssueDetailSheet({
  issue,
  open,
  onOpenChange,
  onDismiss,
  onFix,
  isDismissing,
  isFixing,
}: IssueDetailSheetProps) {
  const { t } = useTranslation();
  if (!issue) return null;

  const severityConfig = SEVERITY_CONFIG[issue.severity];
  const categoryConfigKeys = getCategoryConfigKeysForIssue(issue);
  const navigateActionRoute = buildNavigateActionRoute(issue.navigateAction);
  const detailItems =
    issue.details
      ?.split(/\n\s*\n/)
      .map((detail) => detail.trim())
      .filter(Boolean) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl lg:max-w-2xl">
        <SheetHeader className="shrink-0 space-y-3 pb-6">
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("font-medium", severityConfig.color)}>
              {t(severityConfig.labelKey)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{t(categoryConfigKeys.labelKey)}</span>
          </div>
          <SheetTitle className="text-xl leading-tight">{issue.title}</SheetTitle>
          <p className="text-muted-foreground text-sm leading-relaxed">{issue.message}</p>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 pr-4">
            {issue.affectedItems && issue.affectedItems.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("health:detail.affectedItems", { count: issue.affectedItems.length })}
                </h4>
                <div className="rounded-md border p-1">
                  {issue.affectedItems.map((item) => (
                    <div key={item.id} className="group">
                      {item.route ? (
                        <Link
                          to={item.route}
                          className="hover:bg-muted flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {item.symbol && (
                              <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                                {item.symbol}
                              </Badge>
                            )}
                            <span className="truncate text-sm">{item.name}</span>
                          </div>
                          <Icons.ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2 px-2 py-2">
                          {item.symbol && (
                            <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                              {item.symbol}
                            </Badge>
                          )}
                          <span className="truncate text-sm">{item.name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(issue.affectedCount > 0 ||
              (issue.affectedMvPct != null && issue.affectedMvPct > 0)) &&
              !issue.affectedItems && (
                <div className="space-y-3">
                  <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {t("health:detail.impact")}
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {issue.affectedCount > 0 && (
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">{issue.affectedCount}</p>
                        <p className="text-muted-foreground text-xs">
                          {t("health:detail.affectedItemsCount")}
                        </p>
                      </div>
                    )}
                    {issue.affectedMvPct != null && issue.affectedMvPct > 0 && (
                      <div>
                        <p className="text-2xl font-semibold tabular-nums">
                          {(issue.affectedMvPct * 100).toFixed(1)}%
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {t("health:detail.portfolioImpact")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

            {detailItems.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  {t("health:detail.details")}
                </h4>
                <div className="space-y-2">
                  {detailItems.map((detail, index) => {
                    const lines = detail.split("\n").filter(Boolean);
                    const [title, ...body] = lines;
                    const detailDate = getDetailDate(lines);
                    const detailRoute =
                      detailDate && issue.navigateAction?.route === "/activities"
                        ? buildNavigateActionRoute(issue.navigateAction, {
                            from: detailDate,
                            to: detailDate,
                          })
                        : null;
                    const detailContent = (
                      <div
                        className={cn(
                          "bg-muted/20 rounded-md border px-3 py-2",
                          detailRoute && "hover:bg-muted/40 transition-colors",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            {title && <p className="text-sm font-medium">{title}</p>}
                            {body.map((line, lineIndex) => {
                              const isDateLine = line.startsWith("Date:");
                              return (
                                <p
                                  key={`${line}-${lineIndex}`}
                                  className={cn(
                                    "mt-1 text-sm",
                                    isDateLine
                                      ? "text-foreground font-mono tabular-nums"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {line}
                                </p>
                              );
                            })}
                          </div>
                          {detailRoute && (
                            <Icons.ChevronRight className="text-muted-foreground mt-1 h-4 w-4 shrink-0" />
                          )}
                        </div>
                      </div>
                    );
                    return detailRoute ? (
                      <Link key={`${title}-${index}`} to={detailRoute} className="block">
                        {detailContent}
                      </Link>
                    ) : (
                      <div key={`${title}-${index}`}>{detailContent}</div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-6">
              <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                {t("health:detail.aboutThisIssue")}
              </h4>
              <p className="text-muted-foreground text-sm">
                {t(categoryConfigKeys.descriptionKey)}
              </p>
            </div>
          </div>
        </ScrollArea>

        <div className="shrink-0 space-y-2 border-t pt-4">
          {issue.fixAction && (
            <Button onClick={onFix} disabled={isFixing} className="w-full">
              {isFixing ? (
                <Icons.Spinner className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Icons.Wand2 className="mr-2 h-4 w-4" />
              )}
              {issue.fixAction.label}
            </Button>
          )}

          {issue.navigateAction && (
            <Button variant="outline" className="w-full" asChild>
              <Link to={navigateActionRoute ?? issue.navigateAction.route}>
                <Icons.ArrowRight className="mr-2 h-4 w-4" />
                {issue.navigateAction.label}
              </Link>
            </Button>
          )}

          <ActionConfirm
            confirmTitle={t("health:detail.dismissConfirm.title")}
            confirmMessage={t("health:detail.dismissConfirm.message")}
            confirmButtonText={t("health:detail.dismiss")}
            confirmButtonVariant="default"
            handleConfirm={onDismiss}
            isPending={isDismissing}
            pendingText={t("health:detail.dismissConfirm.pendingText")}
            button={
              <Button variant="ghost" className="text-muted-foreground w-full">
                <Icons.EyeOff className="mr-2 h-4 w-4" />
                {t("health:detail.dismiss")}
              </Button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
