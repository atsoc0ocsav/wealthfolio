import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccessTokens } from "./use-access-tokens";
import { useAgentAudit } from "./use-agent-audit";
import { useMcpServer } from "./use-mcp-server";

const adapterMocks = vi.hoisted(() => ({
  isDesktop: true,
  isWeb: true,
  getMcpStatus: vi.fn(),
  setMcpEnabled: vi.fn(),
  setMcpAuditEnabled: vi.fn(),
  rotateMcpToken: vi.fn(),
  getMcpConnectionInfo: vi.fn(),
  listAgentAccessTokens: vi.fn(),
  createAgentAccessToken: vi.fn(),
  revokeAgentAccessToken: vi.fn(),
  listAgentAuditLog: vi.fn(),
  purgeAgentAuditLog: vi.fn(),
  logger: { error: vi.fn() },
}));

vi.mock("@/adapters", () => adapterMocks);
vi.mock("@wealthfolio/ui/components/ui/use-toast", () => ({ toast: vi.fn() }));

const status = {
  enabled: true,
  autoStart: false,
  auditEnabled: true,
  running: true,
  port: 9170,
  startedAt: "2026-06-09T00:00:00Z",
  tokenFingerprint: "abc123",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useMcpServer", () => {
  it("loads the status and forwards toggle changes to the adapter", async () => {
    adapterMocks.getMcpStatus.mockResolvedValue(status);
    adapterMocks.setMcpEnabled.mockResolvedValue({ ...status, autoStart: true });

    const { result } = renderHook(() => useMcpServer(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.status).toEqual(status));

    await act(async () => {
      await result.current.setEnabledMutation.mutateAsync({ enabled: true, autoStart: true });
    });

    expect(adapterMocks.setMcpEnabled).toHaveBeenCalledWith(true, true);
  });

  it("forwards the audit-logging toggle to the adapter", async () => {
    adapterMocks.getMcpStatus.mockResolvedValue(status);
    adapterMocks.setMcpAuditEnabled.mockResolvedValue({ ...status, auditEnabled: false });

    const { result } = renderHook(() => useMcpServer(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.status).toEqual(status));

    await act(async () => {
      await result.current.setAuditEnabledMutation.mutateAsync(false);
    });

    expect(adapterMocks.setMcpAuditEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(result.current.status?.auditEnabled).toBe(false));
  });
});

describe("useAccessTokens", () => {
  it("creates and revokes tokens through the adapter", async () => {
    adapterMocks.listAgentAccessTokens.mockResolvedValue([]);
    adapterMocks.createAgentAccessToken.mockResolvedValue({ token: "wfp_secret", id: "t1" });
    adapterMocks.revokeAgentAccessToken.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAccessTokens(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.createMutation.mutateAsync({
        name: "Claude",
        expiresAt: "2026-09-09T00:00:00.000Z",
      });
      await result.current.revokeMutation.mutateAsync("t1");
    });

    expect(adapterMocks.createAgentAccessToken).toHaveBeenCalledWith({
      name: "Claude",
      expiresAt: "2026-09-09T00:00:00.000Z",
    });
    expect(adapterMocks.revokeAgentAccessToken).toHaveBeenCalledWith("t1");
  });
});

describe("useAgentAudit", () => {
  it("queries the requested page and purges through the adapter", async () => {
    adapterMocks.listAgentAuditLog.mockResolvedValue({ items: [], totalCount: 0 });
    adapterMocks.purgeAgentAuditLog.mockResolvedValue(3);

    const { result } = renderHook(
      () => useAgentAudit({ page: 2, pageSize: 25, tool: "get_holdings" }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(adapterMocks.listAgentAuditLog).toHaveBeenCalledWith({
        page: 2,
        pageSize: 25,
        tool: "get_holdings",
      }),
    );

    await act(async () => {
      await result.current.purgeMutation.mutateAsync();
    });

    expect(adapterMocks.purgeAgentAuditLog).toHaveBeenCalled();
  });
});
