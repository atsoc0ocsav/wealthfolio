import { useState } from "react";
import { format } from "date-fns";
import type { AgentAccessToken } from "@/adapters";
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
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@wealthfolio/ui/components/ui/table";
import { useAccessTokens } from "../hooks/use-access-tokens";
import { PatCreateDialog } from "./pat-create-dialog";

const formatDate = (value: string | null) => (value ? format(new Date(value), "MMM d, yyyy") : "—");

export function PatTable() {
  const { tokens, isLoading, createMutation, revokeMutation } = useAccessTokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<AgentAccessToken | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Personal access tokens</CardTitle>
            <CardDescription>
              Read-only tokens for MCP clients connecting to this server&apos;s /mcp endpoint.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Icons.Plus className="mr-2 h-4 w-4" />
            Create token
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No access tokens yet. Create one to connect an MCP client.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id} className={token.revokedAt ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell className="font-mono text-xs">wfp_{token.tokenPrefix}…</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Read-only</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(token.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(token.lastUsedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {token.expiresAt ? formatDate(token.expiresAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    {token.revokedAt ? (
                      <Badge variant="outline">Revoked</Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRevoking(token)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <PatCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) createMutation.reset();
        }}
        onCreate={async (input) => {
          const created = await createMutation.mutateAsync(input);
          return created.token;
        }}
        isCreating={createMutation.isPending}
      />

      <AlertDialog open={revoking !== null} onOpenChange={(value) => !value && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke token?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking ? `"${revoking.name}"` : "This token"} will stop working immediately. Any
              MCP client using it will lose access. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeMutation.isPending}
              onClick={() => {
                if (!revoking) return;
                revokeMutation.mutate(revoking.id, { onSuccess: () => setRevoking(null) });
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
