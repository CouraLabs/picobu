import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { options } from '@config/options.ts'
import { type McpServerOptions, mergeMcpServers, normalizeServerMap, PROJECT_MCP_FILENAME, PROJECT_MCP_FILENAME_ALT } from '@integrations/mcp/config.ts'

export const parseProjectMcpJson = (raw: unknown, source = PROJECT_MCP_FILENAME): Array<McpServerOptions> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`)
  }
  const record = raw as Record<string, unknown>
  const servers = record.mcpServers ?? record.servers
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error(`${source} must contain a "mcpServers" object`)
  }
  try {
    return normalizeServerMap(servers)
  } catch (error) {
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const readServersFromFile = async (absolutePath: string, source: string): Promise<Array<McpServerOptions>> => {
  const file = Bun.file(absolutePath)
  if (!(await file.exists())) return []
  let raw: unknown
  try {
    raw = await file.json()
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseProjectMcpJson(raw, source)
}

const isDirectoryEntry = async (dir: string, entry: Dirent): Promise<boolean> => {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try {
    return (await stat(join(dir, entry.name))).isDirectory()
  } catch {
    return false
  }
}

const listFirstLevelDirs = async (dir: string): Promise<Array<string>> => {
  let entries: Array<Dirent>
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const dirs: Array<string> = []
  for (const entry of entries) {
    if (await isDirectoryEntry(dir, entry)) dirs.push(entry.name)
  }
  return dirs.sort()
}

export const projectMcpFileCandidates = (subdirs: ReadonlyArray<string>): Array<string> => {
  const ordered: Array<string> = []
  for (const sub of subdirs) ordered.push(join(sub, PROJECT_MCP_FILENAME_ALT))
  for (const sub of subdirs) ordered.push(join(sub, PROJECT_MCP_FILENAME))
  ordered.push(PROJECT_MCP_FILENAME_ALT, PROJECT_MCP_FILENAME)
  return ordered
}

export interface ProjectMcpScanResult {
  servers: Array<McpServerOptions>
  warnings: Array<string>
}

export const scanProjectMcpServers = async (dir: string): Promise<ProjectMcpScanResult> => {
  const candidates = projectMcpFileCandidates(await listFirstLevelDirs(dir))
  const servers: Array<McpServerOptions> = []
  const warnings: Array<string> = []
  for (const relativePath of candidates) {
    try {
      servers.push(...(await readServersFromFile(join(dir, relativePath), relativePath)))
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { servers: mergeMcpServers([], servers), warnings }
}

export const loadProjectMcpServers = async (dir: string): Promise<Array<McpServerOptions>> => (await scanProjectMcpServers(dir)).servers

export interface McpConfigLoadResult {
  servers: Array<McpServerOptions>
  warning?: string
}

let lastMcpConfigWarning: string | undefined

export const getLastMcpConfigWarning = (): string | undefined => lastMcpConfigWarning

export const loadMcpConfigDetailed = async (dir: string = options.app.cwd): Promise<McpConfigLoadResult> => {
  const { servers: projectServers, warnings } = await scanProjectMcpServers(dir)
  const warning = warnings.length ? warnings.join('\n') : undefined
  lastMcpConfigWarning = warning
  const servers = mergeMcpServers(Object.values(options.mcp.servers), projectServers)
  return warning ? { servers, warning } : { servers }
}

export const loadMcpConfig = async (dir: string = options.app.cwd): Promise<Array<McpServerOptions>> => {
  return (await loadMcpConfigDetailed(dir)).servers
}

export const getMcpServer = async (id: string, dir: string = options.app.cwd): Promise<McpServerOptions | undefined> => (await loadMcpConfig(dir)).find((server) => server.id === id)
