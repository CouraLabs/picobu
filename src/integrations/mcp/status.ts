import { options } from "@config/options.ts";
import { loadMcpConfig, loadProjectMcpServers } from "@integrations/mcp/discover.ts";
import { isMcpAuthActive } from "@integrations/mcp/auth.ts";
import { serverTarget } from "@integrations/mcp/config.ts";
import type { McpManager } from "@integrations/mcp/client.ts";

/**
 * MCP status surface: the configured server list with connection and auth
 * flags. Mirrors `listOAuthProviders()` in `@auth/index.ts` — cheap, no
 * network (the manager supplies connection state when one is running).
 */

/** One row of the server list (CLI table / host UI). */
export type McpServerInfo = {
  id: string;
  type: "http" | "sse" | "stdio";
  /** Human label: url for http/sse, `command args` for stdio. */
  target: string;
  /** Where the entry comes from: the global `mcp` block or the project `.mcp.json`. */
  source: "global" | "project";
  /** Client connected and tools loaded (false when no session is running or connect failed). */
  connected: boolean;
  /** Server uses the OAuth login flow (`auth: true` in config). */
  authRequired: boolean;
  /** Valid credential present (stored and not within the refresh grace of expiry). */
  authActive: boolean;
  /** Connect/auth error, when the manager has one recorded. */
  error?: string;
};

/**
 * The effective server list with auth flags. Pass a manager to include live
 * connection state; without one every `connected` is false (no session).
 */
export const listMcpServers = async (manager?: McpManager): Promise<McpServerInfo[]> => {
  const servers = await loadMcpConfig(options.app.cwd);
  const [projectIds, snapshots] = await Promise.all([
    loadProjectMcpServers(options.app.cwd)
      .then((rows) => new Set(rows.map((server) => server.id)))
      .catch(() => new Set<string>()),
    manager ? manager.snapshot() : Promise.resolve(undefined),
  ]);
  return servers.map((server) => {
    const snapshot = snapshots?.find((s) => s.id === server.id);
    return {
      id: server.id,
      type: server.type,
      target: serverTarget(server),
      // Project wins the merge on collision, so a present project entry is
      // the effective origin of the row.
      source: projectIds.has(server.id) ? "project" : "global",
      connected: snapshot?.connected ?? false,
      authRequired: server.auth === true,
      authActive: server.auth === true ? isMcpAuthActive(server.id) : false,
      ...(snapshot?.error ? { error: snapshot.error } : {}),
    } satisfies McpServerInfo;
  });
};
