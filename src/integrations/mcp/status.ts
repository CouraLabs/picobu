import { options } from "@config/options.ts";
import { loadMcpConfig, loadProjectMcpServers } from "@integrations/mcp/discover.ts";
import { initMcpAuth, isMcpAuthActive } from "@integrations/mcp/auth.ts";
import { serverTarget } from "@integrations/mcp/config.ts";
import type { McpManager } from "@integrations/mcp/client.ts";

export type McpServerInfo = {
  id: string;
  type: "http" | "sse" | "stdio";
  target: string;
  source: "global" | "project";
  connected: boolean;
  authRequired: boolean;
  authActive: boolean;
  error?: string;
};

export const listMcpServers = async (manager?: McpManager): Promise<McpServerInfo[]> => {
  const servers = await loadMcpConfig(options.app.cwd);
  try {
    await initMcpAuth();
  } catch {
  }
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
      source: projectIds.has(server.id) ? "project" : "global",
      connected: snapshot?.connected ?? false,
      authRequired: server.auth === true,
      authActive: server.auth === true ? isMcpAuthActive(server.id) : false,
      ...(snapshot?.error ? { error: snapshot.error } : {}),
    } satisfies McpServerInfo;
  });
};
