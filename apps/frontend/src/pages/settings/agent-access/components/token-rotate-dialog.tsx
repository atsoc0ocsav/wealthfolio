import { useState } from "react";
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
import { Button } from "@wealthfolio/ui/components/ui/button";
import { Icons } from "@wealthfolio/ui/components/ui/icons";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";

interface TokenRotateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Performs the rotation and resolves with the new token. */
  onRotate: () => Promise<string>;
  isRotating: boolean;
}

export function TokenRotateDialog({
  open,
  onOpenChange,
  onRotate,
  isRotating,
}: TokenRotateDialogProps) {
  const [newToken, setNewToken] = useState<string | null>(null);

  const handleOpenChange = (value: boolean) => {
    if (!value) setNewToken(null);
    onOpenChange(value);
  };

  const handleConfirm = async () => {
    try {
      setNewToken(await onRotate());
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
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        {newToken === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Rotate token?</AlertDialogTitle>
              <AlertDialogDescription>
                Rotating generates a new token and invalidates the current one. Connected agents
                will be disconnected, and any copied client configs stop working until you update
                them with the new token.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isRotating}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isRotating}
                onClick={(event) => {
                  // Keep the dialog open to show the new token.
                  event.preventDefault();
                  void handleConfirm();
                }}
              >
                {isRotating ? "Rotating…" : "Rotate token"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>New token</AlertDialogTitle>
              <AlertDialogDescription>
                Copy this token now — you won&apos;t see it again.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-2">
              <p className="bg-muted flex-1 select-all truncate rounded-md px-3 py-2 font-mono text-xs">
                {newToken}
              </p>
              <Button variant="ghost" size="icon" onClick={() => void handleCopy()}>
                <Icons.Copy className="h-4 w-4" />
                <span className="sr-only">Copy token</span>
              </Button>
            </div>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => handleOpenChange(false)}>Done</AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
