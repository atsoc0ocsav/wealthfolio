import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui/components/ui/card";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Label } from "@wealthfolio/ui/components/ui/label";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { Switch } from "@wealthfolio/ui/components/ui/switch";
import { useMcpServer } from "../hooks/use-mcp-server";
import { TokenRotateDialog } from "./token-rotate-dialog";

export function McpServerCard() {
  const {
    status,
    isLoading,
    isError,
    refetchStatus,
    setEnabledMutation,
    setAuditEnabledMutation,
    rotateTokenMutation,
  } = useMcpServer();
  const [rotateOpen, setRotateOpen] = useState(false);

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <Icons.AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <p className="text-muted-foreground text-sm">Failed to load the MCP server status.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refetchStatus()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || !status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>MCP server</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              status.running ? "bg-success" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <CardTitle>MCP server</CardTitle>
        </div>
        <CardDescription>
          {status.running && status.port
            ? `Running at http://127.0.0.1:${status.port}/mcp`
            : "Stopped"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="mcp-enabled">Enable MCP server</Label>
            <p className="text-muted-foreground text-sm">
              Lets MCP clients on this machine read your portfolio.
            </p>
          </div>
          <Switch
            id="mcp-enabled"
            checked={status.enabled}
            disabled={setEnabledMutation.isPending}
            onCheckedChange={(checked) =>
              setEnabledMutation.mutate({ enabled: checked, autoStart: status.autoStart })
            }
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="mcp-auto-start">Start automatically with Wealthfolio</Label>
            <p className="text-muted-foreground text-sm">
              Start the server whenever the app launches.
            </p>
          </div>
          <Switch
            id="mcp-auto-start"
            checked={status.autoStart}
            disabled={setEnabledMutation.isPending}
            onCheckedChange={(checked) =>
              setEnabledMutation.mutate({ enabled: status.enabled, autoStart: checked })
            }
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="mcp-audit-enabled">Log agent activity</Label>
            <p className="text-muted-foreground text-sm">
              Records every agent tool call. Disable to stop writing audit rows.
            </p>
          </div>
          <Switch
            id="mcp-audit-enabled"
            checked={status.auditEnabled}
            disabled={setAuditEnabledMutation.isPending}
            onCheckedChange={(checked) => setAuditEnabledMutation.mutate(checked)}
          />
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rotateTokenMutation.isPending}
            onClick={() => setRotateOpen(true)}
          >
            <Icons.RefreshCw className="mr-2 h-4 w-4" />
            Rotate token
          </Button>
          <p className="text-muted-foreground text-xs">
            Disabling stops the server but keeps the token valid. Rotate the token to revoke access.
          </p>
        </div>
      </CardContent>

      <TokenRotateDialog
        open={rotateOpen}
        onOpenChange={(open) => {
          setRotateOpen(open);
          if (!open) rotateTokenMutation.reset();
        }}
        onRotate={async () => {
          const result = await rotateTokenMutation.mutateAsync();
          return result.token;
        }}
        isRotating={rotateTokenMutation.isPending}
      />
    </Card>
  );
}
