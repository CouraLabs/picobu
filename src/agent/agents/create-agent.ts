import { parseMarkdown, type Frontmatter } from "@agent/markdown/markdown-parser.ts";
import type { AgentCategory, AgentType } from "@agent/agents/types.ts";
type AgentFrontmatter = Frontmatter & {
  name?: string;
  description?: string;
  category?: string;
  tools?: string;
  model?: string;
  color?: string;
};


export const NO_TOOLS = "__none__";


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


function parseCategory(value: string | undefined): AgentCategory {
  return value?.trim().toLowerCase() === "persistent" ? "persistent" : "coding";
}


function parseTools(value: string | undefined): string[] {
  if (value?.trim() === "none") return [NO_TOOLS];
  if (!value || value.trim() === "*") return [];
  return value.split(",").map((t) => t.trim()).filter(Boolean);
}
