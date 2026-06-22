import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@wealthfolio/ui/components/ui/select";
import { Skeleton } from "@wealthfolio/ui/components/ui/skeleton";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";
import { useMcpConnectionInfo } from "../hooks/use-mcp-server";

interface ClientPreset {
  id: string;
  label: string;
  build: (url: string, token: string) => unknown;
}

const CLIENT_PRESETS: ClientPreset[] = [
  {
    id: "mcp-servers",
    label: "Claude / Cursor (mcpServers)",
    build: (url, token) => ({
      mcpServers: {
        wealthfolio: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
  },
  {
    id: "jan",
    label: "Jan",
    build: (url, token) => ({
      Wealthfolio: {
        active: true,
        args: [],
        command: "",
        env: {},
        headers: { Authorization: `Bearer ${token}` },
        type: "http",
        url,
      },
    }),
  },
  {
    id: "generic",
    label: "Generic HTTP",
    build: (url, token) => ({
      url,
      headers: { Authorization: `Bearer ${token}` },
    }),
  },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy failed",
        description: `Could not copy ${label.toLowerCase()}.`,
        variant: "destructive",
      });
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={() => void handleCopy()}>
      {copied ? (
        <Icons.Check className="text-success h-4 w-4" />
      ) : (
        <Icons.Copy className="h-4 w-4" />
      )}
      <span className="sr-only">Copy {label}</span>
    </Button>
  );
}

/** Masked token preview: keep the prefix, hide the rest. */
function maskToken(token: string) {
  const underscore = token.indexOf("_");
  const prefix = underscore > 0 ? token.slice(0, underscore + 1) : "";
  return `${prefix}••••••••`;
}

export function ConnectClientCard({ running }: { running: boolean }) {
  const { data: info, isLoading } = useMcpConnectionInfo(running);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [presetId, setPresetId] = useState(CLIENT_PRESETS[0].id);

  if (!running) {
    return null;
  }

  const preset = CLIENT_PRESETS.find((entry) => entry.id === presetId) ?? CLIENT_PRESETS[0];
  const configJson = info ? JSON.stringify(preset.build(info.url, info.token), null, 2) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect an MCP client</CardTitle>
        <CardDescription>
          Point any MCP client that supports Streamable HTTP at the server URL and authenticate with
          the access token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading || !info ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Server URL</Label>
              <div className="flex items-center gap-2">
                <p className="bg-muted flex-1 select-all truncate rounded-md px-3 py-2 font-mono text-xs">
                  {info.url}
                </p>
                <CopyButton value={info.url} label="server URL" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Access token</Label>
              <div className="flex items-center gap-2">
                <p className="bg-muted flex-1 truncate rounded-md px-3 py-2 font-mono text-xs">
                  {tokenVisible ? info.token : maskToken(info.token)}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTokenVisible((visible) => !visible)}
                >
                  {tokenVisible ? (
                    <Icons.EyeOff className="h-4 w-4" />
                  ) : (
                    <Icons.Eye className="h-4 w-4" />
                  )}
                  <span className="sr-only">
                    {tokenVisible ? "Hide access token" : "Reveal access token"}
                  </span>
                </Button>
                <CopyButton value={info.token} label="access token" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="mcp-client-preset">Client configuration</Label>
              <p className="text-muted-foreground text-sm">
                Ready-to-paste config for your client. It contains the access token.
              </p>
              <Select value={preset.id} onValueChange={setPresetId}>
                <SelectTrigger id="mcp-client-preset" className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_PRESETS.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-start gap-2">
                <pre className="bg-muted text-muted-foreground flex-1 overflow-x-auto rounded-md px-3 py-2 font-mono text-xs">
                  {configJson}
                </pre>
                <CopyButton value={configJson} label="client configuration" />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
