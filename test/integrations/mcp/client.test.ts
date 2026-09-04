import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JSONRPCMessage, MCPTransport } from "@ai-sdk/mcp";
import { createMcpManager } from "@integrations/mcp/client.ts";
import type { McpServerOptions } from "@integrations/mcp/config.ts";

/**
 * Client-manager tests run against an in-process MCP server: a real
 * `MCPTransport` peer answering JSON-RPC (initialize / tools/list / tools/call)
 * — no fetch mocking. All servers use ids that can't collide with the real
 * `~/.picobu` auth store, and none set `auth: true` (that path would hit the
 * network).
 */

const dir = await mkdtemp(join(tmpdir(), "picobu-mcp-client-"));
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A minimal in-process MCP server bound to the MCPTransport interface. */
const createStubServer = (options: {
  tools?: { name: string; description?: string; inputSchema: unknown }[];
  instructions?: string;
  failToolCall?: boolean;
} = {}) => {
  let respond: ((message: JSONRPCMessage) => void) | undefined;
  const counters = { initialize: 0, toolsList: 0, toolCall: 0 };
  let closed = false;

  const handle = async (message: JSONRPCMessage): Promise<unknown> => {
    const request = message as { id?: number | string; method?: string; params?: Record<string, unknown> };
    if (request.id === undefined || request.id === null) return undefined; // notification
    switch (request.method) {
      case "initialize":
        counters.initialize += 1;
        return {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "stub", version: "1.0.0" },
          ...(options.instructions ? { instructions: options.instructions } : {}),
        };
      case "tools/list":
        counters.toolsList += 1;
        return { tools: options.tools ?? [] };
      case "tools/call":
        counters.toolCall += 1;
        if (options.failToolCall) throw new Error("stub tool failure");
        return { content: [{ type: "text", text: "stub result" }] };
      default:
        throw new Error(`stub server: unhandled method "${request.method}"`);
    }
  };

  const transport: MCPTransport = {
    start: async () => {},
    send: async (message) => {
      const result = await handle(message);
      if (result !== undefined) {
        respond?.({
          jsonrpc: "2.0",
          id: (message as { id: number | string }).id,
          result,
        } as JSONRPCMessage);
      }
    },
    close: async () => {
      closed = true;
    },
  };
  // The client assigns onmessage after start(); keep a mutable wiring.
  Object.defineProperty(transport, "onmessage", {
    set(handler) {
      respond = handler;
    },
    get() {
      return respond;
    },
  });

  return { transport, counters, isClosed: () => closed };
};

const SERVERS = (tools: { name: string; description?: string; inputSchema: unknown }[] = []): McpServerOptions[] => [
  { id: "picobu-test-stub", type: "http" as const, url: "in-memory://stub" },
  ...(tools.length ? [{ id: "picobu-test-empty", type: "http" as const, url: "in-memory://empty" }] : []),
];

describe("McpManager against an in-process MCP server", () => {
  test("connects, namespaces tools, and serves the snapshot", async () => {
    const stub = createStubServer({
      tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }],
      instructions: "Say hello first",
    });
    const manager = createMcpManager({
      servers: SERVERS([{ name: "echo", description: "Echo", inputSchema: { type: "object", properties: {} } }]),
      transportFactory: (server) => (server.id === "picobu-test-stub" ? stub.transport : createStubServer().transport),
    });

    const tools = await manager.tools();
    expect(Object.keys(tools)).toEqual(["mcp_picobu-test-stub_echo"]);

    const snapshots = await manager.snapshot();
    expect(snapshots).toHaveLength(2);
    const live = snapshots.find((s) => s.id === "picobu-test-stub")!;
    expect(live.connected).toBe(true);
    expect(live.serverInstructions).toBe("Say hello first");
    expect(live.tools).toHaveLength(1);
    // No server backed the second entry's transport with tools — connected
    // but tool-less servers contribute zero tools.
    const empty = snapshots.find((s) => s.id === "picobu-test-empty")!;
    expect(empty.connected, `empty server error: ${empty.error ?? "none"}`).toBe(true);
    expect(empty.tools).toEqual([]);

    await manager.close();
    expect(stub.isClosed()).toBe(true);
  });

  test("tool lists are cached within the TTL and re-fetched after refresh", async () => {
    const stub = createStubServer({
      tools: [{ name: "t", inputSchema: { type: "object", properties: {} } }],
    });
    const manager = createMcpManager({
      servers: [{ id: "picobu-test-stub", type: "http", url: "in-memory://stub" }],
      transportFactory: () => stub.transport,
    });

    await manager.tools();
    const listCallsAfterFirst = stub.counters.toolsList;
    expect(listCallsAfterFirst).toBeGreaterThan(0);

    // Within the TTL the cache answers — no extra round-trip.
    await manager.tools();
    expect(stub.counters.toolsList).toBe(listCallsAfterFirst);

    // refresh() forces a re-fetch and bumps the prompt-cache generation.
    const before = manager.generation;
    await manager.refresh();
    expect(manager.generation).toBeGreaterThan(before);
    await manager.tools();
    expect(stub.counters.toolsList).toBeGreaterThan(listCallsAfterFirst);

    await manager.close();
  });

  test("initialize happens once per process (reattach state is reused)", async () => {
    const stub = createStubServer({
      tools: [{ name: "t", inputSchema: { type: "object", properties: {} } }],
    });
    const servers = [{ id: "picobu-test-reattach", type: "http" as const, url: "in-memory://reattach" }];
    const first = createMcpManager({ servers, transportFactory: () => stub.transport });
    await first.tools();
    await first.close();
    const initializesAfterFirst = stub.counters.initialize;
    expect(initializesAfterFirst).toBeGreaterThan(0);

    // A fresh manager (a new session) reattaches: no second initialize.
    const second = createMcpManager({ servers, transportFactory: () => stub.transport });
    await second.tools();
    expect(stub.counters.initialize).toBe(initializesAfterFirst);
    await second.close();
  });

  test("a failing transport is recorded per server without breaking the rest", async () => {
    const good = createStubServer({
      tools: [{ name: "t", inputSchema: { type: "object", properties: {} } }],
    });
    const manager = createMcpManager({
      servers: [
        { id: "picobu-test-broken", type: "http", url: "in-memory://broken" },
        { id: "picobu-test-good", type: "http", url: "in-memory://good" },
      ],
      transportFactory: (server) => {
        if (server.id === "picobu-test-broken") {
          const failing: MCPTransport = {
            start: () => Promise.reject(new Error("connection refused")),
            send: () => Promise.reject(new Error("connection refused")),
            close: () => Promise.resolve(),
          };
          return failing;
        }
        return good.transport;
      },
    });

    const tools = await manager.tools();
    expect(Object.keys(tools)).toEqual(["mcp_picobu-test-good_t"]);

    const snapshots = await manager.snapshot();
    const broken = snapshots.find((s) => s.id === "picobu-test-broken")!;
    expect(broken.connected).toBe(false);
    expect(broken.error).toContain("connection refused");
    const healthy = snapshots.find((s) => s.id === "picobu-test-good")!;
    expect(healthy.connected).toBe(true);

    await manager.close();
  });

  test("close() is idempotent", async () => {
    const stub = createStubServer();
    const manager = createMcpManager({
      servers: [{ id: "picobu-test-stub", type: "http", url: "in-memory://stub" }],
      transportFactory: () => stub.transport,
    });
    await manager.tools();
    await manager.close();
    await manager.close();
    expect(stub.isClosed()).toBe(true);
  });
});
