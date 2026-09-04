import type { ListToolsResult } from "@ai-sdk/mcp";

/**
 * LLM-facing docs for MCP tools, rendered into the system prompt's `<Tools>`
 * section in the exact shape `renderToolInfo` (toolset.ts) emits for built-in
 * tools — MCP tools arrive as JSON Schema rather than zod, so they get their
 * own renderer.
 */

/** Longest tool name accepted by the strictest provider (OpenAI function names). */
const MAX_TOOL_NAME_LENGTH = 64;

/** Legal characters for AI SDK tool names. */
const NAME_PATTERN = /[^a-zA-Z0-9_-]/g;

/**
 * Namespaced MCP tool name: `mcp_<serverId>_<toolName>`, restricted to
 * `[a-zA-Z0-9_-]` and capped at 64 chars (the strictest provider limit).
 * Overflow keeps the full tool name (the part that carries meaning) and
 * disambiguates the server portion with a short hash — deterministic across
 * sessions so persisted history stays readable.
 */
export const mcpToolName = (serverId: string, toolName: string): string => {
  const clean = (value: string) => value.replace(NAME_PATTERN, "_");
  const full = `mcp_${clean(serverId)}_${clean(toolName)}`;
  if (full.length <= MAX_TOOL_NAME_LENGTH) return full;
  const suffix = [...serverId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 46657, 7)
    .toString(36)
    .padStart(3, "0");
  const keptTool = clean(toolName).slice(0, MAX_TOOL_NAME_LENGTH - 5 - suffix.length - 1);
  return `mcp_${suffix}_${keptTool}`.slice(0, MAX_TOOL_NAME_LENGTH);
};

/** Render one MCP tool's LLM-facing usage block (same shape as built-ins). */
export const renderMcpToolInfo = (name: string, description: string | undefined, inputSchema: unknown): string => {
  const schema = JSON.stringify(inputSchema ?? { type: "object" }, null, 2);
  return [
    `### ${name}`,
    description ?? "(no description provided by the MCP server)",
    "",
    "JSON Schema:",
    "```json",
    schema,
    "```",
  ].join("\n");
};

/**
 * Render the prompt docs for one server's tools: the optional host-side
 * `instructions` preamble, then each tool's block. Namespaced names keep the
 * model's tool references unambiguous and match `activeTools` entries.
 */
export const renderMcpServerToolsInfo = (
  serverId: string,
  instructions: string | undefined,
  tools: ListToolsResult["tools"],
): string => {
  if (tools.length === 0) return "";
  const blocks = tools.map((tool) =>
    renderMcpToolInfo(mcpToolName(serverId, tool.name), tool.description, tool.inputSchema),
  );
  return [
    ...(instructions ? [`(MCP server "${serverId}": ${instructions})`] : []),
    ...blocks,
  ].join("\n\n");
};
