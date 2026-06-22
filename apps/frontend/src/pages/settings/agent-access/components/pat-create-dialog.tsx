import { useState } from "react";
import { Button } from "@wealthfolio/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@wealthfolio/ui/components/ui/dialog";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { Input } from "@wealthfolio/ui/components/ui/input";
import { Label } from "@wealthfolio/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "none", label: "No expiry" },
] as const;

interface PatCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Creates the token and resolves with the secret (shown once). */
  onCreate: (input: { name: string; expiresAt?: string }) => Promise<string>;
  isCreating: boolean;
}

export function PatCreateDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: PatCreateDialogProps) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<string>("90");
  const [newToken, setNewToken] = useState<string | null>(null);

  const handleOpenChange = (value: boolean) => {
    if (!value) {
      setName("");
      setExpiry("90");
      setNewToken(null);
    }
    onOpenChange(value);
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const expiresAt =
      expiry === "none"
        ? undefined
        : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString();
    try {
      setNewToken(await onCreate({ name: trimmed, expiresAt }));
    } catch (_error) {
      // Error toast is handled by the mutation; keep the dialog open.
    }
  };

  const handleCopy = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      toast({ title: "Copied", description: "Token copied to clipboard." });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Could not copy token.",
        variant: "destructive",
      });
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {newToken === null ? (
          <>
            <DialogHeader>
              <DialogTitle>New access token</DialogTitle>
              <DialogDescription>
                Read-only token for MCP clients connecting to this server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label htmlFor="pat-name">Name</Label>
                <Input
                  id="pat-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Claude Desktop"
                />
              </div>
              <div className="space-y-1">
                <Label>Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={!name.trim() || isCreating}>
                {isCreating ? "Creating…" : "Create token"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Token created</DialogTitle>
              <DialogDescription>
                Copy this token now — you won&apos;t see it again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <p className="bg-muted flex-1 select-all truncate rounded-md px-3 py-2 font-mono text-xs">
                {newToken}
              </p>
              <Button variant="ghost" size="icon" onClick={() => void handleCopy()}>
                <Icons.Copy className="h-4 w-4" />
                <span className="sr-only">Copy token</span>
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
