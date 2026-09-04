import { describe, expect, test } from "bun:test";
import {
  mergeMcpServers,
  normalizeServer,
  normalizeServerMap,
  resolveEnvMap,
  resolveEnvRef,
  resolveServerEnv,
  serverTarget,
} from "@integrations/mcp/config.ts";

describe("resolveEnvRef", () => {
  test("passes plain values through untouched", () => {
    expect(resolveEnvRef("Bearer tok_123")).toBe("Bearer tok_123");
  });

  test("resolves env:VAR to the current environment value", () => {
    process.env.PICOBU_MCP_TEST_TOKEN = "secret-value";
    try {
      expect(resolveEnvRef("env:PICOBU_MCP_TEST_TOKEN")).toBe("secret-value");
    } finally {
      delete process.env.PICOBU_MCP_TEST_TOKEN;
    }
  });

  test("throws on an unset variable (a silently-missing credential would only 401 later)", () => {
    delete process.env.PICOBU_MCP_TEST_MISSING;
    expect(() => resolveEnvRef("env:PICOBU_MCP_TEST_MISSING")).toThrow("PICOBU_MCP_TEST_MISSING");
  });
});

describe("resolveEnvMap", () => {
  test("resolves every entry", () => {
    process.env.PICOBU_MCP_TEST_A = "a";
    try {
      expect(resolveEnvMap({ Authorization: "env:PICOBU_MCP_TEST_A", X: "plain" })).toEqual({
        Authorization: "a",
        X: "plain",
      });
    } finally {
      delete process.env.PICOBU_MCP_TEST_A;
    }
  });

  test("undefined stays undefined", () => {
    expect(resolveEnvMap(undefined)).toBeUndefined();
  });
});

describe("normalizeServer", () => {
  test("explicit type wins and requires url", () => {
    const server = normalizeServer("linear", { type: "http", url: "https://mcp.example.com" });
    expect(server).toEqual({ id: "linear", type: "http", url: "https://mcp.example.com" });
  });

  test("url infers http, command infers stdio", () => {
    expect(normalizeServer("a", { url: "https://x.com" }).type).toBe("http");
    expect(normalizeServer("b", { command: "node", args: ["s.js"] })).toEqual({
      id: "b",
      type: "stdio",
      command: "node",
      args: ["s.js"],
    });
  });

  test("http without url and stdio without command throw", () => {
    expect(() => normalizeServer("a", { type: "http" })).toThrow('"url"');
    expect(() => normalizeServer("b", { type: "stdio" })).toThrow('"command"');
  });

  test("no type/url/command throws with the id in the message", () => {
    expect(() => normalizeServer("c", {})).toThrow('"c"');
  });

  test("non-object entries throw", () => {
    expect(() => normalizeServer("d", "http://x")).toThrow("must be an object");
  });

  test("optional fields are picked up (auth, instructions, maxRetries, headers, env)", () => {
    const server = normalizeServer("e", {
      url: "https://x.com",
      auth: true,
      instructions: "Use for issues",
      maxRetries: 2,
      headers: { Authorization: "env:TOK" },
      env: { KEY: "v" },
    });
    expect(server.auth).toBe(true);
    expect(server.instructions).toBe("Use for issues");
    expect(server.maxRetries).toBe(2);
    expect(server.headers).toEqual({ Authorization: "env:TOK" });
    expect(server.env).toEqual({ KEY: "v" });
  });
});

describe("normalizeServerMap", () => {
  test("normalizes every entry", () => {
    const servers = normalizeServerMap({ a: { url: "https://x" }, b: { command: "node" } });
    expect(servers.map((s) => `${s.id}:${s.type}`)).toEqual(["a:http", "b:stdio"]);
  });

  test("rejects non-object maps", () => {
    expect(() => normalizeServerMap([1])).toThrow("must be an object");
  });
});

describe("mergeMcpServers (project wins on collision)", () => {
  test("keeps global-only ids, project-only ids, and the project version of shared ids", () => {
    const merged = mergeMcpServers(
      [
        { id: "shared", type: "http" as const, url: "https://global" },
        { id: "global-only", type: "http" as const, url: "https://g-only" },
      ],
      [
        { id: "shared", type: "http" as const, url: "https://project" },
        { id: "project-only", type: "http" as const, url: "https://p-only" },
      ],
    );
    expect(merged).toEqual([
      { id: "shared", type: "http", url: "https://project" },
      { id: "global-only", type: "http", url: "https://g-only" },
      { id: "project-only", type: "http", url: "https://p-only" },
    ]);
  });

  test("either side empty is a passthrough", () => {
    expect(mergeMcpServers([], [])).toEqual([]);
    const only = [{ id: "a", type: "http" as const, url: "https://x" }];
    expect(mergeMcpServers(only, [])).toEqual(only);
  });
});

describe("serverTarget", () => {
  test("url for http/sse, command + args for stdio", () => {
    expect(serverTarget({ id: "a", type: "http", url: "https://x/mcp" })).toBe("https://x/mcp");
    expect(serverTarget({ id: "b", type: "stdio", command: "node", args: ["server.js", "--p"] })).toBe(
      "node server.js --p",
    );
  });
});

describe("resolveServerEnv", () => {
  test("resolves headers and env at connect time", () => {
    process.env.PICOBU_MCP_TEST_H = "hval";
    try {
      const resolved = resolveServerEnv({
        id: "a",
        type: "http",
        url: "https://x",
        headers: { Authorization: "env:PICOBU_MCP_TEST_H" },
        env: { K: "env:PICOBU_MCP_TEST_H" },
      });
      expect(resolved.headers).toEqual({ Authorization: "hval" });
      expect(resolved.env).toEqual({ K: "hval" });
    } finally {
      delete process.env.PICOBU_MCP_TEST_H;
    }
  });

  test("servers without maps resolve to empty", () => {
    expect(resolveServerEnv({ id: "a", type: "stdio", command: "node" })).toEqual({});
  });
});
