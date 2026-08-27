import { createAgent } from "./create-agent";
import type { AgentType } from "../../types/agent-type";
import { askMarkdown } from "../../prompts/ask";
import { coderMarkdown } from "../../prompts/coder";
import { planMarkdown } from "../../prompts/plan";
import type { ModelRoleId } from "../../../../libs/options";

/** The registered agents, keyed by id. */
export const AGENTS: Record<string, AgentType> = {
  ask: createAgent(askMarkdown),
  coder: createAgent(coderMarkdown),
  "plan-code": createAgent(planMarkdown),
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

export function listAgents(): { id: string; name: string }[] {
  return Object.entries(AGENTS).map(([id, agent]) => ({ id, name: agent.name }));
}