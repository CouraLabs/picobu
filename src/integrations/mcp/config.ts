export type McpServerOptions = {
  id: string;
  type: "http" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: boolean;
  instructions?: string;
  maxRetries?: number;
};
export type McpOptions = {
  servers: Record<string, McpServerOptions>;
};
export const DEFAULT_MCP_OPTIONS: McpOptions = { servers: {} };

export const PROJECT_MCP_FILENAME = ".mcp.json";

export const resolveEnvRef = (value: string): string => {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  const resolved = process.env[name];
  if (resolved === undefined) {
    throw new Error(`MCP config references unset environment variable "${name}"`);
  }
  return resolved;
};

export const resolveEnvMap = (map: Record<string, string> | undefined): Record<string, string> | undefined =>
  map ? Object.fromEntries(Object.entries(map).map(([k, v]) => [k, resolveEnvRef(v)])) : undefined;

export const resolveServerEnv = (server: McpServerOptions): Pick<McpServerOptions, "headers" | "env"> => ({
  ...(server.headers ? { headers: resolveEnvMap(server.headers) } : {}),
  ...(server.env ? { env: resolveEnvMap(server.env) } : {}),
});

export const serverTarget = (server: McpServerOptions): string => (server.type === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : (server.url ?? ""));

const inferType = (raw: Record<string, unknown>): "http" | "sse" | "stdio" | undefined => {
  if (raw.type === "http" || raw.type === "sse" || raw.type === "stdio") return raw.type;
  if (typeof raw.url === "string") return "http";
  if (typeof raw.command === "string") return "stdio";
  return undefined;
};

export const normalizeServer = (id: string, raw: unknown): McpServerOptions => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`MCP server "${id}" must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const type = inferType(record);
  if (!type) {
    throw new Error(`MCP server "${id}" needs a "type" ("http" | "sse" | "stdio"), a "url", or a "command"`);
  }
  if (type !== "stdio" && typeof record.url !== "string") {
    throw new Error(`MCP server "${id}" (${type}) requires "url"`);
  }
  if (type === "stdio" && typeof record.command !== "string") {
    throw new Error(`MCP server "${id}" (stdio) requires "command"`);
  }
  const server: McpServerOptions = {
    id,
    type,
    ...(type !== "stdio" ? { url: record.url as string } : {}),
    ...(type === "stdio" ? { command: record.command as string } : {}),
  };
  if (Array.isArray(record.args)) server.args = record.args.map(String);
  if (record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)) {
    server.headers = Object.fromEntries(Object.entries(record.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  if (record.env && typeof record.env === "object" && !Array.isArray(record.env)) {
    server.env = Object.fromEntries(Object.entries(record.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  if (typeof record.auth === "boolean") server.auth = record.auth;
  if (typeof record.instructions === "string") server.instructions = record.instructions;
  if (typeof record.maxRetries === "number" && Number.isFinite(record.maxRetries)) {
    server.maxRetries = Math.max(0, Math.floor(record.maxRetries));
  }
  return server;
};

export const normalizeServerMap = (raw: unknown): McpServerOptions[] => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MCP server config must be an object of servers");
  }
  return Object.entries(raw as Record<string, unknown>).map(([id, entry]) => normalizeServer(id, entry));
};

export const mergeMcpServers = (globalServers: McpServerOptions[], projectServers: McpServerOptions[]): McpServerOptions[] => {
  const merged = new Map<string, McpServerOptions>();
  for (const server of globalServers) merged.set(server.id, server);
  for (const server of projectServers) merged.set(server.id, server);
  return [...merged.values()];
};
