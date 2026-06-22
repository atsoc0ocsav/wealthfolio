import {
  createAgentAccessToken,
  isWeb,
  listAgentAccessTokens,
  logger,
  revokeAgentAccessToken,
} from "@/adapters";
import { QueryKeys } from "@/lib/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@wealthfolio/ui/components/ui/use-toast";

export function useAccessTokens() {
  const queryClient = useQueryClient();

  const tokensQuery = useQuery({
    queryKey: [QueryKeys.AGENT_ACCESS_TOKENS],
    queryFn: listAgentAccessTokens,
    enabled: isWeb,
  });

  const createMutation = useMutation({
    mutationFn: (input: { name: string; expiresAt?: string }) => createAgentAccessToken(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.AGENT_ACCESS_TOKENS] });
    },
    onError: (error) => {
      logger.error(`Error creating personal access token: ${String(error)}`);
      toast({
        title: "Failed to create token",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeAgentAccessToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKeys.AGENT_ACCESS_TOKENS] });
      toast({ title: "Token revoked", variant: "success" });
    },
    onError: (error) => {
      logger.error(`Error revoking personal access token: ${String(error)}`);
      toast({
        title: "Failed to revoke token",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    },
  });

  return {
    tokens: tokensQuery.data ?? [],
    isLoading: tokensQuery.isLoading,
    createMutation,
    revokeMutation,
  };
}
