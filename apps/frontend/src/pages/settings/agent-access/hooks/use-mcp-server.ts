import {
  getMcpConnectionInfo,
  getMcpStatus,
  isDesktop,
  logger,
  rotateMcpToken,
  setMcpAuditEnabled,
  setMcpEnabled,
  type McpConnectionInfo,
  type McpRotatedToken,
  type McpServerStatus,
} from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";

export function useMcpServer() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: [QueryKeys.AGENT_MCP_STATUS],
    queryFn: getMcpStatus,
    enabled: isDesktop,
  });

  const applyStatus = (status: McpServerStatus) => {
    queryClient.setQueryData([QueryKeys.AGENT_MCP_STATUS], status);
    queryClient.invalidateQueries({ queryKey: [QueryKeys.AGENT_MCP_CONFIG] });
  };

  const setEnabledMutation = useMutation({
    mutationFn: ({ enabled, autoStart }: { enabled: boolean; autoStart: boolean }) =>
      setMcpEnabled(enabled, autoStart),
    onSuccess: applyStatus,
    onError: (error) => {
      logger.error(`Error updating MCP server settings: ${String(error)}`);
      toast({
        title: "Failed to update MCP server",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const setAuditEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => setMcpAuditEnabled(enabled),
    onSuccess: applyStatus,
    onError: (error) => {
      logger.error(`Error updating MCP audit logging: ${String(error)}`);
      toast({
        title: "Failed to update audit logging",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const rotateTokenMutation = useMutation({
    mutationFn: rotateMcpToken,
    onSuccess: (result: McpRotatedToken) => applyStatus(result.status),
    onError: (error) => {
      logger.error(`Error rotating MCP token: ${String(error)}`);
      toast({
        title: "Failed to rotate token",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    refetchStatus: statusQuery.refetch,
    setEnabledMutation,
    setAuditEnabledMutation,
    rotateTokenMutation,
  };
}

export function useMcpConnectionInfo(running: boolean) {
  return useQuery<McpConnectionInfo>({
    queryKey: [QueryKeys.AGENT_MCP_CONFIG],
    queryFn: getMcpConnectionInfo,
    enabled: isDesktop && running,
  });
}
