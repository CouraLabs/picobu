import { createMCPClient, ElicitationRequestSchema, type InitializeResult, type ListToolsResult, type MCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { options } from "@config/options.ts";
import { describeError } from "@shared/error-report.ts";
import { loadMcpConfig } from "@integrations/mcp/discover.ts";
import { ensureMcpAuth, createMcpAuthProvider } from "@integrations/mcp/auth.ts";
import { resolveServerEnv, type McpServerOptions } from "@integrations/mcp/config.ts";
import { mcpToolName } from "@integrations/mcp/tools-info.ts";

/**
 * The MCP client manager: connects every configured server (global options +
 * project `.mcp.json`), exposes their tools namespaced as
 * `mcp_<serverId>_<toolName>`, and keeps a generation-stamped snapshot for
 * the system prompt. One manager per loop/session; clients connect lazily on
 * first use and are closed via `close()`.
 */

/** How long a fetched tool list is reused before the next fetch. */
const TOOL_TTL_MS = 60_000;

/** Runtime state of one server inside a manager. */
type McpServerRuntime = {
  server: McpServerOptions;
  client?: MCPClient;
  /** Connection/connect error (server stays listed, tools stay empty). */
  error?: string;
  tools?: ListToolsResult["tools"];
  /** Server-provided usage instructions from the initialize handshake. */
  serverInstructions?: string;
};

/** What the system prompt and status surfaces need per server. */
export type McpServerSnapshot = {
  id: string;
  type: "http" | "sse" | "stdio";
  connected: boolean;
  error?: string;
  /** Host-side usage notes (config `instructions`). */
  instructions?: string;
  /** Server-provided instructions (initialize handshake). */
  serverInstructions?: string;
  tools: ListToolsResult["tools"];
};

/** Per-server reattach state, kept process-wide so successive sessions in
 * one run reuse the Streamable HTTP session instead of re-initializing. */
type ReattachState = { sessionId?: string; initializeResult?: InitializeResult };

const reattach = new Map<string, ReattachState>();

/** Namespaced MCP tool set as returned by `mcpClient.tools()`. */
type McpTools = Awaited<ReturnType<MCPClient["tools"]>>;

export type McpManager = {
  /** Namespaced MCP tools for the agent loop (`mcp_<server>_<name>` keys). */
  tools: () => Promise<McpTools>;
  /** Per-server snapshot for the prompt/status: docs, errors, instructions. */
  snapshot: () => Promise<McpServerSnapshot[]>;
  /** Drop the tool cache and re-fetch: bumps the prompt-cache generation. */
  refresh: () => Promise<void>;
  /** Connect every configured server up front (failures recorded per server). */
  connectAll: () => Promise<void>;
  /** Current prompt-cache generation (bumped on connect/refresh). */
  readonly generation: number;
  /** Close every client (server-side MCP sessions stay reattachable). */
  close: () => Promise<void>;
};

/**
 * Test hook: build the transport for a server. Production leaves this unset
 * (http/sse/stdio are constructed from config); tests inject an in-process
 * transport — a real MCPTransport peer, not a fetch mock.
 */
export type McpTransportFactory = (server: McpServerOptions) => MCPTransport;

export const createMcpManager = (
  opts: { dir?: string; servers?: McpServerOptions[]; transportFactory?: McpTransportFactory } = {},
): McpManager => {
  const runtimes = new Map<string, McpServerRuntime>();
  const connecting = new Map<string, Promise<void>>();
  let generation = 0;
  let toolCache:
    | { namespaced: McpTools; expiresAt: number }
    | undefined;

  const configServers = async (): Promise<McpServerOptions[]> =>
    opts.servers ?? (await loadMcpConfig(opts.dir ?? options.app.cwd));

  const runtimeFor = (server: McpServerOptions): McpServerRuntime => {
    let runtime = runtimes.get(server.id);
    if (!runtime) {
      runtime = { server };
      runtimes.set(server.id, runtime);
    }
    return runtime;
  };

  /** Connect one server (idempotent; concurrent calls share one promise). */
  const connect = async (server: McpServerOptions): Promise<void> => {
    const runtime = runtimeFor(server);
    if (runtime.client) return;
    const inFlight = connecting.get(server.id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        await ensureMcpAuth(server);
        const { headers, env } = resolveServerEnv(server);
        const saved = reattach.get(server.id);
        // Streamable HTTP sessions are kept alive on close (`terminateSessionOnClose: false`)
        // so the next session can reattach from the saved state.
        const transport = opts.transportFactory
          ? opts.transportFactory(server)
          : server.type === "stdio"
          ? new Experimental_StdioMCPTransport({
              command: server.command!,
              ...(server.args ? { args: server.args } : {}),
              ...(env ? { env } : {}),
            })
          : {
              type: server.type,
              url: server.url!,
              ...(headers ? { headers } : {}),
              // OAuth-secured servers carry their provider automatically.
              ...(server.auth ? { authProvider: createMcpAuthProvider(server).provider } : {}),
              redirect: "follow" as const,
              terminateSessionOnClose: false as const,
              ...(saved?.sessionId
                ? {
                    initialSessionId: saved.sessionId,
                    onSessionIdChange: (sessionId: string | undefined) => {
                      const state = reattach.get(server.id) ?? {};
                      reattach.set(server.id, { ...state, sessionId });
                    },
                    onSessionExpired: (expired: string) => {
                      const state = reattach.get(server.id);
                      if (state?.sessionId === expired) {
                        reattach.set(server.id, { initializeResult: state.initializeResult });
                      }
                    },
                  }
                : {}),
            };
        const client = await createMCPClient({
          ...(server.maxRetries ? { maxRetries: server.maxRetries } : {}),
          clientName: "picobu",
          capabilities: { elicitation: {} },
          ...(saved?.initializeResult ? { initialInitializeResult: saved.initializeResult } : {}),
          transport,
        });
        // Elicitation: servers may request input mid-tool-call. There is no
        // interactive UI in the headless core yet — decline loudly instead of
        // hanging the run.
        client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
          console.error(
            `picobu: MCP server "${server.id}" requested input ("${request.params.message}") — declined (elicitation UI not supported yet)`,
          );
          return { action: "decline" };
        });
        runtime.client = client;
        runtime.error = undefined;
        runtime.serverInstructions = client.instructions;
        if (client.initializeResult) {
          const state = reattach.get(server.id) ?? {};
          reattach.set(server.id, { ...state, initializeResult: client.initializeResult });
        }
        generation += 1;
        toolCache = undefined;
      } catch (error) {
        runtime.client = undefined;
        runtime.error = describeError(error).message;
      } finally {
        connecting.delete(server.id);
      }
    })();
    connecting.set(server.id, promise);
    return promise;
  };

  /** Connect every configured server (failures recorded per server). */
  const connectAll = async (): Promise<void> => {
    const servers = await configServers();
    await Promise.all(servers.map(connect));
  };

  const ensureConnected = async (): Promise<void> => {
    const servers = await configServers();
    const missing = servers.filter((server) => !runtimeFor(server).client);
    if (missing.length) await Promise.all(missing.map(connect));
  };

  const tools = async (): Promise<McpTools> => {
    if (toolCache && toolCache.expiresAt > Date.now()) return toolCache.namespaced;
    await ensureConnected();
    const namespaced: McpTools = {};
    for (const runtime of runtimes.values()) {
      if (!runtime.client) continue;
      try {
        if (!runtime.tools) runtime.tools = (await runtime.client.listTools()).tools;
        const serverTools = await runtime.client.tools();
        for (const [name, tool] of Object.entries(serverTools)) {
          namespaced[mcpToolName(runtime.server.id, name)] = tool;
        }
      } catch (error) {
        runtime.error = describeError(error).message;
      }
    }
    toolCache = { namespaced, expiresAt: Date.now() + TOOL_TTL_MS };
    return namespaced;
  };

  const snapshot = async (): Promise<McpServerSnapshot[]> => {
    await ensureConnected();
    const servers = await configServers();
    return servers.map((server) => {
      const runtime = runtimeFor(server);
      return {
        id: server.id,
        type: server.type,
        connected: Boolean(runtime.client),
        ...(runtime.error ? { error: runtime.error } : {}),
        ...(server.instructions ? { instructions: server.instructions } : {}),
        ...(runtime.serverInstructions ? { serverInstructions: runtime.serverInstructions } : {}),
        tools: runtime.tools ?? [],
      };
    });
  };

  const refresh = async (): Promise<void> => {
    for (const runtime of runtimes.values()) {
      runtime.tools = undefined;
      runtime.error = runtime.client ? undefined : runtime.error;
    }
    toolCache = undefined;
    generation += 1;
    await ensureConnected();
  };

  const close = async (): Promise<void> => {
    await Promise.all(
      [...runtimes.values()].map(async (runtime) => {
        if (!runtime.client) return;
        try {
          await runtime.client.close();
        } catch {
          // Best-effort teardown — a failing close must not mask the rest.
        }
        runtime.client = undefined;
        runtime.tools = undefined;
      }),
    );
    toolCache = undefined;
  };

  return {
    tools,
    snapshot,
    refresh,
    connectAll,
    close,
    get generation() {
      return generation;
    },
  };
};
