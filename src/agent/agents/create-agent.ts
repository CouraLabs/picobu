import type { AgentCategory, AgentType } from "@agent/agents/types.ts";
import { type Frontmatter, parseMarkdown } from "@agent/markdown/markdown-parser.ts";

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
  const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : "agent";
  const description = typeof parsed.description === "string" ? parsed.description : "";
  const model = typeof parsed.model === "string" ? parsed.model : undefined;
  const color = typeof parsed.color === "string" ? parsed.color : undefined;
  return {
    name,
    description,
    category: parseCategory(parsed.category),
    tools: parseTools(parsed.tools),
    model,
    color,
    prompt: parsed.content,
  };
}

function parseCategory(value: unknown): AgentCategory {
  return typeof value === "string" && value.trim().toLowerCase() === "persistent" ? "persistent" : "coding";
}

function parseTools(value: unknown): string[] {
  if (typeof value !== "string") return [];
  if (value.trim().toLowerCase() === "none") return [NO_TOOLS];
  if (value.trim() === "" || value.trim() === "*") return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
