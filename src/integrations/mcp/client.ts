import { createMCPClient, ElicitationRequestSchema, type InitializeResult, type ListToolsResult, type MCPClient, type MCPTransport } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { options } from "@config/options.ts";
import { createMcpAuthProvider, ensureMcpAuth } from "@integrations/mcp/auth.ts";
import { type McpServerOptions, resolveServerEnv } from "@integrations/mcp/config.ts";
import { loadMcpConfig } from "@integrations/mcp/discover.ts";
import { mcpToolName } from "@integrations/mcp/tools-info.ts";
import { describeError } from "@shared/error-report.ts";

const TOOL_TTL_MS = 60_000;

type McpServerRuntime = {
  server: McpServerOptions;
  client?: MCPClient;
  error?: string;
  tools?: ListToolsResult["tools"];
  serverInstructions?: string;
};

export type McpServerSnapshot = {
  id: string;
  type: "http" | "sse" | "stdio";
  connected: boolean;
  error?: string;
  instructions?: string;
  serverInstructions?: string;
  tools: ListToolsResult["tools"];
};

type ReattachState = { sessionId?: string; initializeResult?: InitializeResult };
const reattach = new Map<string, ReattachState>();

type McpTools = Awaited<ReturnType<MCPClient["tools"]>>;
export type McpManager = {
  tools: () => Promise<McpTools>;
  snapshot: () => Promise<McpServerSnapshot[]>;
  refresh: () => Promise<void>;
  connectAll: () => Promise<void>;
  readonly generation: number;
  close: () => Promise<void>;
};

export type McpTransportFactory = (server: McpServerOptions) => MCPTransport;
export const createMcpManager = (opts: { dir?: string; servers?: McpServerOptions[]; transportFactory?: McpTransportFactory } = {}): McpManager => {
  const runtimes = new Map<string, McpServerRuntime>();
  const connecting = new Map<string, Promise<void>>();
  let generation = 0;
  let toolCache: { namespaced: McpTools; expiresAt: number } | undefined;
  const configServers = async (): Promise<McpServerOptions[]> => opts.servers ?? (await loadMcpConfig(opts.dir ?? options.app.cwd));
  const runtimeFor = (server: McpServerOptions): McpServerRuntime => {
    let runtime = runtimes.get(server.id);
    if (!runtime) {
      runtime = { server };
      runtimes.set(server.id, runtime);
    } else {
      runtime.server = server;
    }
    return runtime;
  };

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
                ...(server.auth ? { authProvider: createMcpAuthProvider(server).provider } : {}),
                redirect: "follow" as const,
                terminateSessionOnClose: false as const,
                ...(saved?.sessionId ? { initialSessionId: saved.sessionId } : {}),
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
              };
        const client = await createMCPClient({
          ...(server.maxRetries ? { maxRetries: server.maxRetries } : {}),
          clientName: "picobu",
          capabilities: { elicitation: {} },
          ...(saved?.initializeResult ? { initialInitializeResult: saved.initializeResult } : {}),
          transport,
        });
        client.onElicitationRequest(ElicitationRequestSchema, async (request) => {
          console.error(`picobu: MCP server "${server.id}" requested input ("${request.params.message}") — declined (elicitation UI not supported yet)`);
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
        const serverTools = await runtime.client.tools();
        if (!runtime.tools) {
          runtime.tools = Object.entries(serverTools).map(([name, tool]) => ({
            name,
            description: (tool as { description?: string }).description,
            inputSchema: (tool as { inputSchema?: unknown }).inputSchema,
          })) as ListToolsResult["tools"];
        }
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
        } catch {}
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
