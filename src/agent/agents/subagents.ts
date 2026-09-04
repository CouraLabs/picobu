import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { options } from "@config/options.ts";
import { createAgent, NO_TOOLS } from "@agent/agents/create-agent.ts";
import { parseMarkdownFile } from "@agent/markdown/markdown-parser.ts";
import type { AgentType } from "@agent/agents/types.ts";
import { executorSubagentMarkdown } from "@agent/subagent/executor.ts";
import { explorerSubagentMarkdown } from "@agent/subagent/explorer.ts";
import { reviewerSubAgent } from "@agent/subagent/reviewer.ts";

/**
 * Interactive flow tools are structurally forbidden for sub sessions: their
 * pending output would pause the sub run with nobody able to answer (the pause
 * sits inside a tool call of the parent), hanging the spawn forever. They are
 * dropped from the subagent's tool list AND from the sub session's registered
 * tool set, so even a hallucinated call cannot pause the loop.
 */
export const INTERACTIVE_FLOW_TOOLS: readonly string[] = ["ask", "plan-write", "plan-exit"];

/** Maximum spawn nesting depth (a root spawn is depth 0; its child depth 1). */
export const SUBAGENT_DEPTH_CAP = 3;

/** Shared rules appended to every subagent's system prompt at build time —
 * built-ins and `.agents/agents/*.md` project files all inherit them. */
export const SUBAGENT_RULES = `## Subagent Rules
- You are a subagent. You cannot interact with the user: there is no ask, no plan submission, no questions. Never wait for user input — it will never come.
- Conclude your task autonomously with the information in your prompt and what you can gather from the repository. Resolve ambiguities yourself; state assumptions in your final answer instead of asking.
- When done, produce a complete final report: what you did, what you found/changed, and anything the caller should know. Your last text message is your deliverable — it is summarized and returned to the calling agent.`;

/** Built-in subagents, keyed by name. Project files override these by name. */
export const BUILT_IN_SUBAGENTS: Record<string, AgentType> = {
  executor: createAgent(executorSubagentMarkdown),
  explorer: createAgent(explorerSubagentMarkdown),
  reviewer: createAgent(reviewerSubAgent),
};

const subagentsDir = (cwd: string): string => join(cwd, ".agents", "agents");

/**
 * Discover subagents: built-ins plus `<cwd>/.agents/agents/*.md` (project
 * files override built-ins by name, case-insensitively). Best-effort:
 * unreadable/malformed files are skipped. Each file needs `name` +
 * `description` frontmatter; `tools` is a comma list, `model` an optional
 * `<providerId>/<modelId>` override.
 */
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
        tools: typeof parsed.tools === "string"
          ? parsed.tools.split(",").map((t) => t.trim()).filter(Boolean)
          : [],
        model: typeof parsed.model === "string" ? parsed.model : undefined,
        prompt: parsed.content,
      });
    } catch (error) {
      console.error(`picobu: failed to load subagent ${file}:`, error);
    }
  }
  return [...byName.values()];
}

/** Resolve one subagent by name (project files override built-ins). */
export async function getSubagent(name: string, cwd: string = options.app.cwd): Promise<AgentType | undefined> {
  return (await listSubagents(cwd)).find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Prepare a subagent definition for a sub session: strip the interactive flow
 * tools (structurally forbidden — see `INTERACTIVE_FLOW_TOOLS`) and append the
 * shared `Subagent Rules` block to the prompt. An agent def that listed only
 * interactive tools collapses to the no-tools sentinel rather than "all tools".
 */
export function prepareSubagent(def: AgentType): AgentType {
  const tools = def.tools.filter((t) => !INTERACTIVE_FLOW_TOOLS.includes(t));
  return {
    ...def,
    tools: def.tools.length > 0 && tools.length === 0 ? [NO_TOOLS] : tools,
    prompt: `${def.prompt.trim()}\n\n${SUBAGENT_RULES}`,
  };
}
