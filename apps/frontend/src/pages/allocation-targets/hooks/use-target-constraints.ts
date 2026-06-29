import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listTargetConstraints, saveTargetConstraints } from "@/adapters";
import type { AllocationTargetConstraint, ConstraintSubjectType } from "@/lib/types";

export function useTargetConstraints(targetId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["target-constraints", targetId];

  const query = useQuery({
    queryKey,
    queryFn: () => listTargetConstraints(targetId!),
    enabled: !!targetId,
    staleTime: Infinity,
  });

  const mutation = useMutation({
    mutationFn: (constraints: AllocationTargetConstraint[]) =>
      saveTargetConstraints(targetId!, constraints),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  const constraints = query.data ?? [];

  const sellBlockedAssetIds = constraints
    .filter(
      (c) =>
        c.subjectType === "asset" &&
        (c.action === "sell" || c.action === "trade") &&
        c.effect === "block",
    )
    .map((c) => c.subjectId);

  const sellBlockedAccountIds = constraints
    .filter(
      (c) =>
        c.subjectType === "account" &&
        (c.action === "sell" || c.action === "trade") &&
        c.effect === "block",
    )
    .map((c) => c.subjectId);

  function toggleSellBlock(subjectType: ConstraintSubjectType, subjectId: string) {
    const existing = constraints.find(
      (c) =>
        c.subjectType === subjectType &&
        c.subjectId === subjectId &&
        c.action === "sell" &&
        c.effect === "block",
    );
    const now = new Date().toISOString();
    const next = existing
      ? constraints.filter((c) => c.id !== existing.id)
      : [
          ...constraints,
          {
            id: crypto.randomUUID(),
            targetId: targetId!,
            subjectType,
            subjectId,
            action: "sell" as const,
            effect: "block" as const,
            reason: null,
            metadataJson: null,
            createdAt: now,
            updatedAt: now,
          } satisfies AllocationTargetConstraint,
        ];
    mutation.mutate(next);
  }

  function hasSellBlock(subjectType: ConstraintSubjectType, subjectId: string): boolean {
    return constraints.some(
      (c) =>
        c.subjectType === subjectType &&
        c.subjectId === subjectId &&
        c.action === "sell" &&
        c.effect === "block",
    );
  }

  return {
    constraints,
    sellBlockedAssetIds,
    sellBlockedAccountIds,
    toggleSellBlock,
    hasSellBlock,
    isLoading: query.isLoading,
  };
}
