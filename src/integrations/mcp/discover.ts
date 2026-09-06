import { options } from "@config/options.ts";
import {
  mergeMcpServers,
  normalizeServerMap,
  PROJECT_MCP_FILENAME,
  type McpServerOptions,
} from "@integrations/mcp/config.ts";




export const parseProjectMcpJson = (raw: unknown, source = PROJECT_MCP_FILENAME): McpServerOptions[] => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const record = raw as Record<string, unknown>;
  const servers = record.mcpServers ?? record.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error(`${source} must contain a "mcpServers" object`);
  }
  try {
    return normalizeServerMap(servers);
  } catch (error) {
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
};


export const loadProjectMcpServers = async (dir: string): Promise<McpServerOptions[]> => {
  const file = Bun.file(`${dir}/${PROJECT_MCP_FILENAME}`);
  if (!(await file.exists())) return [];
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    throw new Error(
      `${PROJECT_MCP_FILENAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseProjectMcpJson(raw);
};


export const loadMcpConfig = async (dir: string = options.app.cwd): Promise<McpServerOptions[]> => {
  let projectServers: McpServerOptions[] = [];
  try {
    projectServers = await loadProjectMcpServers(dir);
  } catch (error) {
    console.error("picobu:", error instanceof Error ? error.message : error);
  }
  return mergeMcpServers(Object.values(options.mcp.servers), projectServers);
};


export const getMcpServer = async (id: string, dir: string = options.app.cwd): Promise<McpServerOptions | undefined> =>
  (await loadMcpConfig(dir)).find((server) => server.id === id);
