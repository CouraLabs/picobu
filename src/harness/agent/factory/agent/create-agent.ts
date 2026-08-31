import { parseMarkdown, type Frontmatter } from "../../markdown/markdown-parser";
import type { AgentCategory, AgentType } from "../../types/agent-type";

type AgentFrontmatter = Frontmatter & {
  name?: string;
  description?: string;
  category?: string;
  tools?: string;
  model?: string;
  color?: string;
};

/** Sentinel tool name that never matches a registered tool (for `tools: none`). */
export const NO_TOOLS = "__none__";

/** Resolve an agent prompt markdown string into an `AgentType`. */
export function createAgent(markdown: string): AgentType {
  const parsed = parseMarkdown<AgentFrontmatter>(markdown);
  return {
    name: parsed.name ?? "agent",
    description: parsed.description ?? "",
    category: parseCategory(parsed.category),
    tools: parseTools(parsed.tools),
    model: parsed.model,
    color: parsed.color,
    prompt: parsed.content,
  };
}

/** Parse a frontmatter `category` value. Anything but `persistent` defaults to `coding`. */
function parseCategory(value: string | undefined): AgentCategory {
  return value?.trim().toLowerCase() === "persistent" ? "persistent" : "coding";
}

/** Parse a frontmatter `tools` value into a name list. `*` (or empty) = all tools;
 * `none` maps to the `NO_TOOLS` sentinel so the agent resolves to an empty set. */
function parseTools(value: string | undefined): string[] {
  if (value?.trim() === "none") return [NO_TOOLS];
  if (!value || value.trim() === "*") return [];
  return value.split(",").map((t) => t.trim()).filter(Boolean);
}
