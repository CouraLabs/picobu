import { parseMarkdown, type Frontmatter } from "../../markdown/markdown-parser";
import type { AgentType } from "../../types/agent-type";

type AgentFrontmatter = Frontmatter & {
  name?: string;
  description?: string;
  tools?: string;
  model?: string;
  color?: string;
};

/** Resolve an agent prompt markdown string into an `AgentType`. */
export function createAgent(markdown: string): AgentType {
  const parsed = parseMarkdown<AgentFrontmatter>(markdown);
  return {
    name: parsed.name ?? "agent",
    description: parsed.description ?? "",
    tools: parseTools(parsed.tools),
    model: parsed.model,
    color: parsed.color,
    prompt: parsed.content,
  };
}

/** Parse a frontmatter `tools` value into a name list. `*` (or empty) = all tools. */
function parseTools(value: string | undefined): string[] {
  if (!value || value.trim() === "*") return [];
  return value.split(",").map((t) => t.trim()).filter(Boolean);
}