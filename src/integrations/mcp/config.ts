/**
 * MCP server configuration types, validation, and merging. The `mcp` block
 * lives in `<systemDir>/options.json` (global) with an optional project-level
 * `.mcp.json` (Claude-style `mcpServers` map) merged over it — project entries
 * win on id collision. Header and stdio `env` values support the `"env:VAR"`
 * ref convention, resolved at connect time.
 *
 * Pure module: no `options`/filesystem imports, so `@config/options.ts` can
 * reuse the types and defaults without an import cycle.
 */

export type McpServerOptions = {
  /** Server id (the config key). */
  id: string;
  type: "http" | "sse" | "stdio";
  /** Server URL (`http`/`sse` only). */
  url?: string;
  /** Extra HTTP headers (`http`/`sse`); values may be `"env:VAR"` refs. */
  headers?: Record<string, string>;
  /** Executable to spawn (`stdio` only). */
  command?: string;
  /** Executable arguments (`stdio` only). */
  args?: string[];
  /** Spawn environment additions (`stdio` only); values may be `"env:VAR"` refs. */
  env?: Record<string, string>;
  /** Enable the MCP OAuth login flow for this server (tokens in `mcp-auth.json`). */
  auth?: boolean;
  /** Host-side usage notes rendered above the server's tools in the prompt. */
  instructions?: string;
  /** Opt-in retries for transient `tools/call` transport failures (default 0). */
  maxRetries?: number;
};

export type McpOptions = {
  servers: Record<string, McpServerOptions>;
};

export const DEFAULT_MCP_OPTIONS: McpOptions = { servers: {} };

/** Where project-level `.mcp.json` files are discovered. */
export const PROJECT_MCP_FILENAME = ".mcp.json";

/**
 * Resolve `"env:VAR"` refs in a config value: `"env:HOME"` → the env var's
 * current value. Anything without the prefix passes through untouched.
 * Throws when the referenced variable is unset — a silently-missing
 * credential would only surface later as an opaque 401.
 */
export const resolveEnvRef = (value: string): string => {
  if (!value.startsWith("env:")) return value;
  const name = value.slice(4);
  const resolved = process.env[name];
  if (resolved === undefined) {
    throw new Error(`MCP config references unset environment variable "${name}"`);
  }
  return resolved;
};

/** Apply `resolveEnvRef` to every value of a header/env map. */
export const resolveEnvMap = (
  map: Record<string, string> | undefined,
): Record<string, string> | undefined =>
  map ? Object.fromEntries(Object.entries(map).map(([k, v]) => [k, resolveEnvRef(v)])) : undefined;

/** Connect-time view of a server: `env:` refs applied to headers/env. */
export const resolveServerEnv = (
  server: McpServerOptions,
): Pick<McpServerOptions, "headers" | "env"> => ({
  ...(server.headers ? { headers: resolveEnvMap(server.headers) } : {}),
  ...(server.env ? { env: resolveEnvMap(server.env) } : {}),
});

/** Human label for a server: url for http/sse, `command args` for stdio. */
export const serverTarget = (server: McpServerOptions): string =>
  server.type === "stdio" ? [server.command, ...(server.args ?? [])].join(" ") : (server.url ?? "");

/**
 * Infer the transport type for a raw config entry: explicit `type` wins,
 * then `url` → `http`, then `command` → `stdio`.
 */
const inferType = (raw: Record<string, unknown>): "http" | "sse" | "stdio" | undefined => {
  if (raw.type === "http" || raw.type === "sse" || raw.type === "stdio") return raw.type;
  if (typeof raw.url === "string") return "http";
  if (typeof raw.command === "string") return "stdio";
  return undefined;
};

/** Validate + normalize one raw config entry (from options.json or .mcp.json). */
export const normalizeServer = (id: string, raw: unknown): McpServerOptions => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`MCP server "${id}" must be an object`);
  }
  const record = raw as Record<string, unknown>;
  const type = inferType(record);
  if (!type) {
    throw new Error(
      `MCP server "${id}" needs a "type" ("http" | "sse" | "stdio"), a "url", or a "command"`,
    );
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
    server.headers = Object.fromEntries(
      Object.entries(record.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  if (record.env && typeof record.env === "object" && !Array.isArray(record.env)) {
    server.env = Object.fromEntries(
      Object.entries(record.env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  if (typeof record.auth === "boolean") server.auth = record.auth;
  if (typeof record.instructions === "string") server.instructions = record.instructions;
  if (typeof record.maxRetries === "number") server.maxRetries = record.maxRetries;
  return server;
};

/** Normalize a full raw server map (id → entry) with per-entry errors. */
export const normalizeServerMap = (raw: unknown): McpServerOptions[] => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("MCP server config must be an object of servers");
  }
  return Object.entries(raw as Record<string, unknown>).map(([id, entry]) => normalizeServer(id, entry));
};

/**
 * Merge global + project server lists: project entries win on id collision.
 * `env:` refs are NOT resolved here — that happens at connect time so a
 * missing variable is reported where the server is actually used.
 */
export const mergeMcpServers = (
  globalServers: McpServerOptions[],
  projectServers: McpServerOptions[],
): McpServerOptions[] => {
  const merged = new Map<string, McpServerOptions>();
  for (const server of globalServers) merged.set(server.id, server);
  for (const server of projectServers) merged.set(server.id, server);
  return [...merged.values()];
};
