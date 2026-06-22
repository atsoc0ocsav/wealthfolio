import { useState } from "react";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@wealthfolio/ui/components/ui/alert-dialog";
import { Badge } from "@wealthfolio/ui/components/ui/badge";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wealthfolio/ui/components/ui/card";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Input } from "@wealthfolio/ui/components/ui/input";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wealthfolio/ui/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAgentAudit } from "../hooks/use-agent-audit";

const PAGE_SIZE = 25;

function outcomeVariant(outcome: string): "success" | "warning" | "destructive" | "secondary" {
  switch (outcome) {
    case "success":
      return "success";
    case "denied":
      return "warning";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

export function AuditLogTable({ disabledNotice }: { disabledNotice?: string }) {
  const [page, setPage] = useState(1);
  const [toolFilter, setToolFilter] = useState("");
  const [purgeOpen, setPurgeOpen] = useState(false);

  const debouncedToolFilter = useDebouncedValue(toolFilter, 300);
  const tool = debouncedToolFilter.trim() || undefined;
  const { items, totalCount, isLoading, purgeMutation } = useAgentAudit({
    page,
    pageSize: PAGE_SIZE,
    tool,
  });
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Agent activity</CardTitle>
            <CardDescription>Recent tool calls made by connected agents.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={purgeMutation.isPending}
            onClick={() => setPurgeOpen(true)}
          >
            <Icons.Trash2 className="mr-2 h-4 w-4" />
            Clear log
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabledNotice && (
          <p className="text-muted-foreground bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2 text-sm">
            <Icons.Info className="h-4 w-4 shrink-0" aria-hidden />
            {disabledNotice}
          </p>
        )}
        <Input
          value={toolFilter}
          onChange={(event) => {
            setToolFilter(event.target.value);
            setPage(1);
          }}
          placeholder="Filter by exact tool name"
          className="max-w-xs"
        />

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {tool ? "No entries match this tool name." : "No agent activity recorded yet."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Actor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap">
                    {format(new Date(entry.createdAt), "MMM d, yyyy HH:mm:ss")}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.tool}</TableCell>
                  <TableCell>
                    <Badge
                      variant={outcomeVariant(entry.outcome)}
                      title={entry.errorMessage ?? undefined}
                    >
                      {entry.outcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs" title={entry.actorFingerprint}>
                    {entry.actorFingerprint.slice(0, 12)}
                    {entry.actorFingerprint.length > 12 ? "…" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {totalCount > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm">
              Page {page} of {pageCount} · {totalCount} {totalCount === 1 ? "entry" : "entries"}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <Icons.ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <Icons.ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear audit log?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every agent activity entry. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={purgeMutation.isPending}
              onClick={() => {
                purgeMutation.mutate(undefined, { onSuccess: () => setPage(1) });
              }}
            >
              <Icons.Trash className="mr-2 h-4 w-4" />
              Clear log
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
