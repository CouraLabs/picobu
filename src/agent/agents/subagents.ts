import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createAgent, NO_TOOLS } from "@agent/agents/create-agent.ts";
import type { AgentType } from "@agent/agents/types.ts";
import { parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";
import { executorSubagentMarkdown } from "@agent/subagent/executor.ts";
import { explorerSubagentMarkdown } from "@agent/subagent/explorer.ts";
import { reviewerSubAgent } from "@agent/subagent/reviewer.ts";
import { options } from "@config/options.ts";

export const INTERACTIVE_FLOW_TOOLS: readonly string[] = ["ask", "plan-write", "plan-exit"];

export const SUBAGENT_DEPTH_CAP = 3;

export const SUBAGENT_RULES = `## Subagent Rules
- You are a subagent. You cannot interact with the user: there is no ask, no plan submission, no questions. Never wait for user input — it will never come.
- Conclude your task autonomously with the information in your prompt and what you can gather from the repository. Resolve ambiguities yourself; state assumptions in your final answer instead of asking.
- Always finish with a complete, self-contained summary report as your final text message: what you did, what you found/changed, and anything the caller should know. Never end on a bare tool call. Your last text message is returned verbatim to the calling agent, so it must stand alone.`;

export const BUILT_IN_SUBAGENTS: Record<string, AgentType> = {
  executor: createAgent(executorSubagentMarkdown),
  explorer: createAgent(explorerSubagentMarkdown),
  reviewer: createAgent(reviewerSubAgent),
};

const subagentsDir = (cwd: string): string => join(cwd, ".agents", "agents");

const parseSubagentTools = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  if (value.trim().toLowerCase() === "none") return [NO_TOOLS];
  if (value.trim() === "" || value.trim() === "*") return [];
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
};

export async function listSubagents(cwd: string = options.app.cwd): Promise<AgentType[]> {
  const byName = new Map<string, AgentType>();
  for (const def of Object.values(BUILT_IN_SUBAGENTS)) byName.set(def.name.toLowerCase(), def);
  let files: string[];
  try {
    files = (await readdir(subagentsDir(cwd))).filter((f) => f.endsWith(".md"));
  } catch {
    return [...byName.values()];
  }
  for (const file of files) {
    try {
      const parsed = await parseMarkdownFile(join(subagentsDir(cwd), file));
      const name = typeof parsed.name === "string" ? parsed.name : "";
      if (!name) continue;
      byName.set(name.toLowerCase(), {
        name,
        description: typeof parsed.description === "string" ? parsed.description : "",
        category: "coding",
        tools: parseSubagentTools(parsed.tools),
        model: typeof parsed.model === "string" ? parsed.model : undefined,
        prompt: parsed.content,
      });
    } catch (error) {
      console.error(`picobu: failed to load subagent ${file}:`, error);
    }
  }
  return [...byName.values()];
}

export async function getSubagent(name: string, cwd: string = options.app.cwd): Promise<AgentType | undefined> {
  return (await listSubagents(cwd)).find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function prepareSubagent(def: AgentType): AgentType {
  if (def.tools.includes(NO_TOOLS)) {
    return {
      ...def,
      tools: [NO_TOOLS],
      prompt: `${def.prompt.trim()}\n\n${SUBAGENT_RULES}`,
    };
  }
  const tools = def.tools.filter((t) => !INTERACTIVE_FLOW_TOOLS.includes(t));
  return {
    ...def,
    tools: def.tools.length > 0 && tools.length === 0 ? [NO_TOOLS] : tools,
    prompt: `${def.prompt.trim()}\n\n${SUBAGENT_RULES}`,
  };
}
