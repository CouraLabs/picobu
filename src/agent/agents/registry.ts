import { createAgent } from "@agent/agents/create-agent.ts";
import type { AgentCategory, AgentType } from "@agent/agents/types.ts";
import { askMarkdown } from "@agent/prompts/ask.ts";
import { coderMarkdown } from "@agent/prompts/coder.ts";
import { planMarkdown } from "@agent/prompts/plan.ts";
import { persistentMarkdown } from "@agent/prompts/persistent.ts";
import type { ModelRoleId } from "@config/options.ts";


export const AGENTS: Record<string, AgentType> = {
  ask: createAgent(askMarkdown),
  coder: createAgent(coderMarkdown),
  "plan-code": createAgent(planMarkdown),
  persistent: createAgent(persistentMarkdown),
};


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


export function listAgents(
  category?: AgentCategory,
): { id: string; name: string; category: AgentCategory }[] {
  return Object.entries(AGENTS)
    .filter(([, agent]) => !category || agent.category === category)
    .map(([id, agent]) => ({ id, name: agent.name, category: agent.category }));
}
