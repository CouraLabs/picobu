import { createAgent } from '@agent/agents/create-agent.ts'
import type { AgentCategory, AgentType } from '@agent/agents/types.ts'
import { listModels } from '@agent/model/resolver.ts'
import { askMarkdown } from '@agent/prompts/ask.ts'
import { brainstormMarkdown } from '@agent/prompts/brainstorm.ts'
import { coderMarkdown } from '@agent/prompts/coder.ts'
import { persistentMarkdown } from '@agent/prompts/persistent.ts'
import { planMarkdown } from '@agent/prompts/plan.ts'
import { type ModelRoleId, options, type ProviderModelReasoningEffort, resolveModelRole } from '@config/options.ts'

export const AGENTS: Record<string, AgentType> = {
  ask: createAgent(askMarkdown),
  brainstorm: createAgent(brainstormMarkdown),
  coder: createAgent(coderMarkdown),
  'plan-code': createAgent(planMarkdown),
  persistent: createAgent(persistentMarkdown),
}

export const DEFAULT_AGENT_ROLE: Record<string, ModelRoleId> = {
  ask: 'flash',
  brainstorm: 'heavy',
  coder: 'flash',
  'plan-code': 'heavy',
}

export const DEFAULT_AGENT_ID = 'ask'

export interface AgentModelChoice {
  modelKey: string
  thinking: ProviderModelReasoningEffort
}

const AGENT_ROLE_THINKING: Partial<Record<ModelRoleId, ModelRoleId>> = {
  flash: 'flashThinking',
  heavy: 'heavyThinkingLevel',
}

export function resolveAgentModel(agentId: string): AgentModelChoice | undefined {
  const role = DEFAULT_AGENT_ROLE[agentId]
  if (!role) return undefined
  try {
    const resolved = resolveModelRole(options.harness, role)
    const thinkingRole = AGENT_ROLE_THINKING[role]
    const thinking = (thinkingRole ? resolveModelRole(options.harness, thinkingRole).thinking : resolved.thinking) ?? 'medium'
    return { modelKey: resolved.modelKey, thinking }
  } catch {
    const first = listModels()[0]
    if (!first) return undefined
    return { modelKey: first.key, thinking: 'medium' }
  }
}

export function getAgent(name: string): AgentType {
  const agent = AGENTS[name]
  if (!agent) {
    throw new Error(`Unknown agent "${name}". Known agents: ${Object.keys(AGENTS).join(', ')}`)
  }
  return agent
}

export const getDefaultAgent = (): AgentType => getAgent(DEFAULT_AGENT_ID)

export function listAgents(category?: AgentCategory): Array<{ id: string; name: string; category: AgentCategory }> {
  return Object.entries(AGENTS)
    .filter(([, agent]) => !category || agent.category === category)
    .map(([id, agent]) => ({ id, name: agent.name, category: agent.category }))
}
