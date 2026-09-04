import { describe, expect, test } from "bun:test";
import { mcpToolName, renderMcpServerToolsInfo, renderMcpToolInfo } from "@integrations/mcp/tools-info.ts";

describe("mcpToolName (namespacing + sanitization)", () => {
  test("prefixes with the server id", () => {
    expect(mcpToolName("linear", "createIssue")).toBe("mcp_linear_createIssue");
  });

  test("sanitizes illegal characters in both parts", () => {
    expect(mcpToolName("my server.dev", "tool/name")).toBe("mcp_my_server_dev_tool_name");
  });

  test("long names are capped at 64 chars deterministically", () => {
    const longTool = "a".repeat(80);
    const first = mcpToolName("linear", longTool);
    const second = mcpToolName("linear", longTool);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).toBe(second); // deterministic across sessions
    expect(first).toContain("a".repeat(10)); // keeps the meaningful tool-name part
  });

  test("different servers hashing to the same cap produce different names", () => {
    const longTool = "b".repeat(80);
    const one = mcpToolName("server-one", longTool);
    const two = mcpToolName("server-two", longTool);
    expect(one).not.toBe(two);
  });
});

describe("renderMcpToolInfo", () => {
  test("renders the same block shape as built-in tools (description + JSON Schema)", () => {
    const info = renderMcpToolInfo("mcp_linear_createIssue", "Create an issue", {
      type: "object",
      properties: { title: { type: "string" } },
    });
    expect(info).toContain("### mcp_linear_createIssue");
    expect(info).toContain("Create an issue");
    expect(info).toContain("```json");
    expect(info).toContain('"title"');
  });

  test("missing description gets an explicit placeholder", () => {
    expect(renderMcpToolInfo("t", undefined, { type: "object" })).toContain(
      "(no description provided by the MCP server)",
    );
  });
});

describe("renderMcpServerToolsInfo", () => {
  const tools = [
    { name: "echo", description: "Echo text", inputSchema: { type: "object", properties: {} } },
    { name: "ping", inputSchema: { type: "object", properties: {} } },
  ];

  test("renders a host instructions preamble above the tool blocks", () => {
    const info = renderMcpServerToolsInfo("linear", "Use for issue tracking", tools as never);
    expect(info.indexOf("(MCP server \"linear\": Use for issue tracking)")).toBe(0);
    expect(info).toContain("### mcp_linear_echo");
    expect(info).toContain("### mcp_linear_ping");
  });

  test("server-provided instructions work the same way", () => {
    const info = renderMcpServerToolsInfo("linear", "Prefer batch queries", tools as never);
    expect(info).toContain("Prefer batch queries");
  });

  test("zero tools render nothing (even with instructions)", () => {
    expect(renderMcpServerToolsInfo("linear", "Use for issues", [])).toBe("");
  });

  test("no instructions renders tool blocks only", () => {
    const info = renderMcpServerToolsInfo("linear", undefined, tools as never);
    expect(info).not.toContain('(MCP server "');
    expect(info).toContain("### mcp_linear_echo");
  });
});
