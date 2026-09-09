import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMcpAuthProvider,
  getMcpCredential,
  initMcpAuth,
  initMcpAuthFilePath,
  isMcpAuthActive,
  MCP_REDIRECT_URL,
  readMcpAuthFile,
  removeMcpCredential,
  resetMcpAuthCache,
  setMcpCredential,
} from "../../src/integrations/mcp/auth.ts";
import { createMcpManager } from "../../src/integrations/mcp/client.ts";
import {
  DEFAULT_MCP_OPTIONS,
  mergeMcpServers,
  normalizeServer,
  normalizeServerMap,
  resolveEnvMap,
  resolveEnvRef,
  serverTarget,
} from "../../src/integrations/mcp/config.ts";
import { parseProjectMcpJson } from "../../src/integrations/mcp/discover.ts";
import { mcpToolName, renderMcpServerToolsInfo, renderMcpToolInfo } from "../../src/integrations/mcp/tools-info.ts";
import { initLockDir } from "../../src/shared/lock.ts";

describe("mcpToolName", () => {
  test("passes short names through", () => {
    expect(mcpToolName("srv", "search")).toBe("mcp_srv_search");
  });
  test("sanitizes unsafe characters", () => {
    expect(mcpToolName("my server!", "do thing?")).toBe("mcp_my_server__do_thing_");
  });
  test("caps long names at 64 chars", () => {
    const name = mcpToolName("server-with-long-id-0123456789", `${"a".repeat(100)}1`);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name.startsWith("mcp_")).toBe(true);
  });
  test("hashes long names uniquely and deterministically", () => {
    const base = "server-with-long-id-0123456789";
    const first = mcpToolName(base, `${"a".repeat(100)}1`);
    const second = mcpToolName(base, `${"a".repeat(100)}2`);
    expect(first).not.toBe(second);
    expect(mcpToolName(base, `${"a".repeat(100)}1`)).toBe(first);
  });
});

describe("renderMcpToolInfo", () => {
  test("contains header description and json schema", () => {
    const out = renderMcpToolInfo("mcp_srv_search", "Search things", { type: "object", properties: { q: { type: "string" } } });
    expect(out).toContain("### mcp_srv_search");
    expect(out).toContain("Search things");
    expect(out).toContain("```json");
    expect(out).toContain('"q"');
  });
  test("falls back when description is missing", () => {
    const out = renderMcpToolInfo("mcp_srv_search", undefined, { type: "object" });
    expect(out).toContain("### mcp_srv_search");
    expect(out).toContain("no description");
  });
  test("server renderer joins instructions and tools or empty", () => {
    expect(renderMcpServerToolsInfo("s", undefined, [])).toBe("");
    const out = renderMcpServerToolsInfo("s", "be nice", [
      { name: "a", description: "does a", inputSchema: { type: "object" } },
      { name: "b", description: undefined, inputSchema: { type: "object" } },
    ]);
    expect(out).toContain('MCP server "s": be nice');
    expect(out).toContain("mcp_s_a");
    expect(out).toContain("mcp_s_b");
  });
});

describe("normalizeServer", () => {
  test("infers http from url and stdio from command", () => {
    expect(normalizeServer("a", { url: "https://x.example/mcp" })).toEqual({ id: "a", type: "http", url: "https://x.example/mcp" });
    expect(normalizeServer("b", { command: "bunx", args: ["mcp"] })).toEqual({ id: "b", type: "stdio", command: "bunx", args: ["mcp"] });
  });
  test("throws when type cannot be inferred or required fields miss", () => {
    expect(() => normalizeServer("c", {})).toThrow('MCP server "c"');
    expect(() => normalizeServer("d", { type: "http" })).toThrow('requires "url"');
    expect(() => normalizeServer("e", { type: "stdio" })).toThrow('requires "command"');
    expect(() => normalizeServer("f", "nope")).toThrow("must be an object");
  });
  test("clamps maxRetries to floored zero-or-more", () => {
    expect(normalizeServer("f", { url: "https://x/m", maxRetries: -2 }).maxRetries).toBe(0);
    expect(normalizeServer("g", { url: "https://x/m", maxRetries: 2.9 }).maxRetries).toBe(2);
    expect(normalizeServer("h", { url: "https://x/m", maxRetries: Infinity }).maxRetries).toBeUndefined();
    expect(normalizeServer("i", { url: "https://x/m", maxRetries: NaN }).maxRetries).toBeUndefined();
    expect(normalizeServer("j", { url: "https://x/m" }).maxRetries).toBeUndefined();
  });
  test("stringifies headers env and keeps auth instructions", () => {
    const out = normalizeServer("k", { url: "https://x/m", headers: { a: 1 }, env: { K: 2 }, auth: true, instructions: "use it" });
    expect(out.headers).toEqual({ a: "1" });
    expect(out.env).toEqual({ K: "2" });
    expect(out.auth).toBe(true);
    expect(out.instructions).toBe("use it");
  });
  test("normalizeServerMap maps entries and rejects non objects", () => {
    expect(() => normalizeServerMap([])).toThrow("must be an object");
    expect(normalizeServerMap({ a: { url: "https://x/m" } })).toEqual([{ id: "a", type: "http", url: "https://x/m" }]);
  });
  test("project servers override global servers by id", () => {
    const merged = mergeMcpServers(
      [{ id: "a", type: "http", url: "https://global/x" }],
      [
        { id: "a", type: "http", url: "https://project/x" },
        { id: "b", type: "stdio", command: "c" },
      ],
    );
    expect(merged.find((s) => s.id === "a")?.url).toBe("https://project/x");
    expect(merged.find((s) => s.id === "b")?.command).toBe("c");
  });
  test("env refs resolve and targets render", () => {
    process.env.PICOBU_TEST_VAR = "hello";
    expect(resolveEnvRef("env:PICOBU_TEST_VAR")).toBe("hello");
    expect(resolveEnvRef("plain")).toBe("plain");
    expect(() => resolveEnvRef("env:DEFINITELY_UNSET_VAR_XYZ")).toThrow("unset environment variable");
    expect(resolveEnvMap(undefined)).toBeUndefined();
    expect(resolveEnvMap({ K: "env:PICOBU_TEST_VAR" })).toEqual({ K: "hello" });
    expect(serverTarget({ id: "s", type: "stdio", command: "bunx", args: ["a"] })).toBe("bunx a");
    expect(serverTarget({ id: "h", type: "http", url: "https://x/m" })).toBe("https://x/m");
    expect(DEFAULT_MCP_OPTIONS).toEqual({ servers: {} });
  });
});

describe("parseProjectMcpJson", () => {
  test("accepts mcpServers and servers keys", () => {
    expect(parseProjectMcpJson({ mcpServers: { a: { url: "https://x/m" } } })).toEqual([{ id: "a", type: "http", url: "https://x/m" }]);
    expect(parseProjectMcpJson({ servers: { a: { command: "c" } } })).toEqual([{ id: "a", type: "stdio", command: "c" }]);
  });
  test("rejects non objects missing keys and bad entries", () => {
    expect(() => parseProjectMcpJson(null)).toThrow("must contain a JSON object");
    expect(() => parseProjectMcpJson({})).toThrow('must contain a "mcpServers" object');
    expect(() => parseProjectMcpJson({ mcpServers: { a: {} } })).toThrow(".mcp.json: ");
    expect(() => parseProjectMcpJson({ mcpServers: { a: {} } }, "custom.json")).toThrow("custom.json: ");
  });
});

describe("mcp manager snapshot without connecting", () => {
  test("failed transport yields disconnected snapshot with empty tools", async () => {
    const manager = createMcpManager({
      servers: [{ id: "demo", type: "stdio", command: "false" }],
      transportFactory: () => {
        throw new Error("no transport in test");
      },
    });
    const snapshot = await manager.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.id).toBe("demo");
    expect(snapshot[0]?.type).toBe("stdio");
    expect(snapshot[0]?.connected).toBe(false);
    expect(snapshot[0]?.tools).toEqual([]);
    expect(typeof snapshot[0]?.error).toBe("string");
    expect(await manager.tools()).toEqual({});
    expect(typeof manager.generation).toBe("number");
    await manager.close();
  });
});

describe("mcp auth redirect", () => {
  test("uses localhost callback with default port", () => {
    expect(MCP_REDIRECT_URL).toBe("http://localhost:19888/callback");
  });
  test("allows same origin authorization server", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "https://api.example.com/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("https://api.example.com/mcp", "https://api.example.com/auth")).not.toThrow();
  });
  test("enforces https for remote authorization servers", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "https://api.example.com/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("https://api.example.com/mcp", "http://api.example.com/auth")).toThrow("https required");
  });
  test("allows same root subdomain authorization server", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "https://api.example.com/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("https://api.example.com/mcp", "https://auth.example.com/oauth")).not.toThrow();
  });
  test("rejects unrelated authorization server origin", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "https://api.example.com/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("https://api.example.com/mcp", "https://evil.com/oauth")).toThrow("unexpected OAuth authorization server");
  });
  test("allows same origin http for localhost servers", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "http://localhost:3000/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("http://localhost:3000/mcp", "http://localhost:3000/auth")).not.toThrow();
  });
  test("rejects unparsable authorization server url", () => {
    const { provider } = createMcpAuthProvider({ id: "t", type: "http", url: "https://api.example.com/mcp" });
    expect(() => provider.validateAuthorizationServerURL!("https://api.example.com/mcp", "nota-a-url")).toThrow();
  });
});

describe("mcp auth file", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "picobu-mcp-auth-"));
    initLockDir(dir);
    initMcpAuthFilePath(join(dir, "mcp-auth.json"));
  });
  afterEach(async () => {
    resetMcpAuthCache();
    await rm(dir, { recursive: true, force: true });
  });
  test("reads missing corrupt and array files as empty", async () => {
    const path = join(dir, "mcp-auth.json");
    expect(await readMcpAuthFile(path)).toEqual({});
    await Bun.write(path, "not json{{{");
    expect(await readMcpAuthFile(path)).toEqual({});
    await Bun.write(path, "[1,2]");
    expect(await readMcpAuthFile(path)).toEqual({});
  });
  test("saveClientInformation skips when no tokens exist", async () => {
    await initMcpAuth();
    const { provider } = createMcpAuthProvider({ id: "srv", type: "http", url: "https://x.example/mcp" });
    await provider.saveClientInformation!({ client_id: "c" } as unknown as { client_id: string });
    expect(getMcpCredential("srv")).toBeUndefined();
    expect(await Bun.file(join(dir, "mcp-auth.json")).exists()).toBe(false);
  });
  test("credentials roundtrip and client info persists after tokens", async () => {
    await initMcpAuth();
    await setMcpCredential("srv", { tokens: { access_token: "a", token_type: "bearer" } } as unknown as Parameters<typeof setMcpCredential>[1]);
    expect(getMcpCredential("srv")?.tokens.access_token).toBe("a");
    const { provider } = createMcpAuthProvider({ id: "srv", type: "http", url: "https://x.example/mcp" });
    await provider.saveClientInformation!({ client_id: "c2" } as unknown as { client_id: string });
    expect(getMcpCredential("srv")?.clientInformation).toEqual({ client_id: "c2" });
  });
  test("isMcpAuthActive handles missing expired and fresh entries", async () => {
    await initMcpAuth();
    expect(isMcpAuthActive("nope")).toBe(false);
    await setMcpCredential("plain", { tokens: { access_token: "a", token_type: "bearer" } } as unknown as Parameters<typeof setMcpCredential>[1]);
    expect(isMcpAuthActive("plain")).toBe(true);
    await setMcpCredential("old", { tokens: { access_token: "a", token_type: "bearer" }, expiresAt: Date.now() - 1000 } as unknown as Parameters<
      typeof setMcpCredential
    >[1]);
    expect(isMcpAuthActive("old")).toBe(false);
    await setMcpCredential("fresh", { tokens: { access_token: "a", token_type: "bearer" }, expiresAt: Date.now() + 10 * 60 * 1000 } as unknown as Parameters<
      typeof setMcpCredential
    >[1]);
    expect(isMcpAuthActive("fresh")).toBe(true);
  });
  test("removeMcpCredential reports removal once", async () => {
    await initMcpAuth();
    await setMcpCredential("srv", { tokens: { access_token: "a", token_type: "bearer" } } as unknown as Parameters<typeof setMcpCredential>[1]);
    expect(await removeMcpCredential("srv")).toBe(true);
    expect(await removeMcpCredential("srv")).toBe(false);
  });
});
