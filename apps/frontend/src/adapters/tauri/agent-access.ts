// Agent Access Commands (embedded MCP server)
import type {
  AgentAccessStatus,
  AgentAccessToken,
  AgentAuditEntry,
  AgentAuditPage,
  AgentAuditQuery,
  CreatedAgentAccessToken,
  McpConnectionInfo,
  McpRotatedToken,
  McpServerStatus,
} from "../types";

import { invoke, logger } from "./core";

/** Raw audit row as serialized by the Tauri backend (snake_case, scopes as JSON). */
interface McpAuditLogRow {
  id: string;
  session_id: string;
  actor_kind: string;
  actor_fingerprint: string;
  tool: string;
  scopes_json: string;
  args_summary: string | null;
  outcome: string;
  error_message: string | null;
  created_at: string;
}

const toAuditEntry = (row: McpAuditLogRow): AgentAuditEntry => {
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.scopes_json);
    if (Array.isArray(parsed)) {
      scopes = parsed.filter((scope): scope is string => typeof scope === "string");
    }
  } catch (_error) {
    // Malformed scopes JSON — show the entry without scopes.
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    actorKind: row.actor_kind,
    actorFingerprint: row.actor_fingerprint,
    tool: row.tool,
    scopes,
    argsSummary: row.args_summary,
    outcome: row.outcome,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
};

export const getMcpStatus = async (): Promise<McpServerStatus> => {
  try {
    return await invoke<McpServerStatus>("mcp_get_status");
  } catch (error) {
    logger.error("Error fetching MCP server status.");
    throw error;
  }
};

export const setMcpEnabled = async (
  enabled: boolean,
  autoStart: boolean,
): Promise<McpServerStatus> => {
  try {
    return await invoke<McpServerStatus>("mcp_set_enabled", { enabled, autoStart });
  } catch (error) {
    logger.error("Error updating MCP server settings.");
    throw error;
  }
};

export const rotateMcpToken = async (): Promise<McpRotatedToken> => {
  try {
    return await invoke<McpRotatedToken>("mcp_rotate_token");
  } catch (error) {
    logger.error("Error rotating MCP token.");
    throw error;
  }
};

export const setMcpAuditEnabled = async (enabled: boolean): Promise<McpServerStatus> => {
  try {
    return await invoke<McpServerStatus>("mcp_set_audit_enabled", { enabled });
  } catch (error) {
    logger.error("Error updating MCP audit logging setting.");
    throw error;
  }
};

export const getMcpConnectionInfo = async (): Promise<McpConnectionInfo> => {
  try {
    return await invoke<McpConnectionInfo>("mcp_get_connection_info");
  } catch (error) {
    logger.error("Error fetching MCP connection info.");
    throw error;
  }
};

export const listAgentAuditLog = async (query: AgentAuditQuery): Promise<AgentAuditPage> => {
  try {
    const result = await invoke<{ items: McpAuditLogRow[]; totalCount: number }>(
      "mcp_list_audit_log",
      { page: query.page, pageSize: query.pageSize, tool: query.tool },
    );
    return { items: result.items.map(toAuditEntry), totalCount: result.totalCount };
  } catch (error) {
    logger.error("Error listing agent audit log.");
    throw error;
  }
};

export const purgeAgentAuditLog = async (): Promise<number> => {
  try {
    return await invoke<number>("mcp_purge_audit_log");
  } catch (error) {
    logger.error("Error purging agent audit log.");
    throw error;
  }
};

// Personal access tokens are a web-server concept.

export const getAgentAccessStatus = (): Promise<AgentAccessStatus> =>
  Promise.reject(new Error("Personal access tokens are managed in the web app"));

export const listAgentAccessTokens = (): Promise<AgentAccessToken[]> =>
  Promise.reject(new Error("Personal access tokens are managed in the web app"));

export const createAgentAccessToken = (_input: {
  name: string;
  expiresAt?: string;
}): Promise<CreatedAgentAccessToken> =>
  Promise.reject(new Error("Personal access tokens are managed in the web app"));

export const revokeAgentAccessToken = (_id: string): Promise<void> =>
  Promise.reject(new Error("Personal access tokens are managed in the web app"));
