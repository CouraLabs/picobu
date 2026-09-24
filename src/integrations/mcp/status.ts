import { options } from '@config/options.ts'
import { initMcpAuth, isMcpAuthActive, usesMcpAuth } from '@integrations/mcp/auth.ts'
import type { McpManager } from '@integrations/mcp/client.ts'
import { mergeMcpServers, serverTarget } from '@integrations/mcp/config.ts'
import { scanProjectMcpServers } from '@integrations/mcp/discover.ts'

export interface McpServerInfo {
  id: string
  type: 'http' | 'sse' | 'stdio'
  target: string
  source: 'global' | 'project'
  connected: boolean
  authRequired: boolean
  authActive: boolean
  error?: string
}

export const listMcpServers = async (manager?: McpManager): Promise<Array<McpServerInfo>> => {
  const { servers: projectServers } = await scanProjectMcpServers(options.app.cwd)
  const servers = mergeMcpServers(Object.values(options.mcp.servers), projectServers)
  try {
    await initMcpAuth()
  } catch {}
  const snapshots = manager ? await manager.snapshot() : undefined
  const projectIds = new Set(projectServers.map((server) => server.id))
  return servers.map((server) => {
    const snapshot = snapshots?.find((s) => s.id === server.id)
    return {
      id: server.id,
      type: server.type,
      target: serverTarget(server),
      source: projectIds.has(server.id) ? 'project' : 'global',
      connected: snapshot?.connected ?? false,
      authRequired: usesMcpAuth(server),
      authActive: usesMcpAuth(server) && isMcpAuthActive(server.id),
      ...(snapshot?.error ? { error: snapshot.error } : {}),
    } satisfies McpServerInfo
  })
}
