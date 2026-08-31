import { createAgent } from "./create-agent";
import type { AgentCategory, AgentType } from "../../types/agent-type";
import { askMarkdown } from "../../prompts/ask";
import { coderMarkdown } from "../../prompts/coder";
import { planMarkdown } from "../../prompts/plan";
import { persistentMarkdown } from "../../prompts/persistent";
import type { ModelRoleId } from "../../../../libs/options";

/** The registered agents, keyed by id. */
export const AGENTS: Record<string, AgentType> = {
  ask: createAgent(askMarkdown),
  coder: createAgent(coderMarkdown),
  "plan-code": createAgent(planMarkdown),
  persistent: createAgent(persistentMarkdown),
};

/** The model role each default agent runs on. */
export const DEFAULT_AGENT_ROLE: Record<string, ModelRoleId> = {
  ask: "flash",
  coder: "flash",
  "plan-code": "heavy",
};

export const DEFAULT_AGENT_ID = "ask";

export function getAgent(name: string): AgentType {
  return AGENTS[name] ?? AGENTS[DEFAULT_AGENT_ID]!;
}

export const getDefaultAgent = (): AgentType => AGENTS[DEFAULT_AGENT_ID]!;

/** List agents, optionally restricted to one session-mode category. */
export function listAgents(
  category?: AgentCategory,
): { id: string; name: string; category: AgentCategory }[] {
  return Object.entries(AGENTS)
    .filter(([, agent]) => !category || agent.category === category)
    .map(([id, agent]) => ({ id, name: agent.name, category: agent.category }));
}
