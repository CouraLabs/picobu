import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectMcpServers, parseProjectMcpJson } from "@integrations/mcp/discover.ts";

const dir = await mkdtemp(join(tmpdir(), "picobu-mcp-discover-"));
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseProjectMcpJson", () => {
  test("accepts the Claude-style mcpServers shape", () => {
    const servers = parseProjectMcpJson({
      mcpServers: {
        linear: { type: "http", url: "https://mcp.linear.app/mcp", auth: true },
        local: { command: "node", args: ["server.js"] },
      },
    });
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({ id: "linear", type: "http", url: "https://mcp.linear.app/mcp", auth: true });
    expect(servers[1]).toEqual({ id: "local", type: "stdio", command: "node", args: ["server.js"] });
  });

  test("accepts the lenient servers shape", () => {
    expect(parseProjectMcpJson({ servers: { a: { url: "https://x" } } })).toEqual([
      { id: "a", type: "http", url: "https://x" },
    ]);
  });

  test("malformed shapes throw with the file name", () => {
    expect(() => parseProjectMcpJson("nope")).toThrow(".mcp.json");
    expect(() => parseProjectMcpJson({})).toThrow('"mcpServers"');
    expect(() => parseProjectMcpJson({ mcpServers: [] })).toThrow('"mcpServers"');
    expect(() => parseProjectMcpJson({ mcpServers: { broken: {} } })).toThrow('"broken"');
  });
});

describe("loadProjectMcpServers", () => {
  test("missing file resolves to an empty list", async () => {
    expect(await loadProjectMcpServers(dir)).toEqual([]);
  });

  test("reads and normalizes the file", async () => {
    await Bun.write(
      join(dir, ".mcp.json"),
      JSON.stringify({ mcpServers: { fs: { command: "npx", args: ["-y", "fs-mcp"] } } }),
    );
    expect(await loadProjectMcpServers(dir)).toEqual([
      { id: "fs", type: "stdio", command: "npx", args: ["-y", "fs-mcp"] },
    ]);
  });

  test("invalid JSON throws a descriptive error", async () => {
    await Bun.write(join(dir, ".mcp.json"), "{not json");
    expect(loadProjectMcpServers(dir)).rejects.toThrow("not valid JSON");
  });

  test("a valid-JSON but wrong-shaped file throws", async () => {
    await Bun.write(join(dir, ".mcp.json"), JSON.stringify({ something: "else" }));
    expect(loadProjectMcpServers(dir)).rejects.toThrow('"mcpServers"');
  });
});
