import { agentIdFromName } from '@agent/agents/agent-id.ts'
import { createAgent } from '@agent/agents/create-agent.ts'
import type { AgentCategory, AgentType } from '@agent/agents/types.ts'
import { listModels } from '@agent/model/resolver.ts'
import { AGENT_PROMPT_FILES, readPromptMarkdown } from '@agent/prompts/prompt-files.ts'
import { type ModelRoleId, options, type ProviderModelReasoningEffort, resolveModelRole } from '@config/options.ts'

export const AGENTS: Record<string, AgentType> = {
  ask: createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.ask)),
  grill: createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.grill)),
  coder: createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.coder)),
  'plan-code': createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.plan)),
  persistent: createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.persistent)),
  optioneer: createAgent(readPromptMarkdown(AGENT_PROMPT_FILES.optioneer)),
}

export const DEFAULT_AGENT_ROLE: Record<string, ModelRoleId> = {
  ask: 'flash',
  grill: 'heavy',
  coder: 'flash',
  'plan-code': 'heavy',
  optioneer: 'heavy',
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

export function resolveHarnessAgentOverride(name: string): AgentModelChoice | undefined {
  const map = options.harness?.agent
  if (!map) return undefined
  const target = agentIdFromName(name)
  const key = Object.keys(map).find((candidate) => agentIdFromName(candidate) === target)
  if (!key) return undefined
  const value = map[key]?.trim()
  if (!value) return undefined
  const role = value as ModelRoleId
  if (role === 'tiny' || role === 'flash' || role === 'flashThinking' || role === 'heavy' || role === 'heavyThinkingLevel') {
    try {
      const resolved = resolveModelRole(options.harness, role)
      const thinkingRole = AGENT_ROLE_THINKING[role]
      const thinking = (thinkingRole ? resolveModelRole(options.harness, thinkingRole).thinking : resolved.thinking) ?? 'medium'
      return { modelKey: resolved.modelKey, thinking }
    } catch {
      return undefined
    }
  }
  return { modelKey: value, thinking: 'medium' }
}

export function resolveAgentModel(agentId: string): AgentModelChoice | undefined {
  const override = resolveHarnessAgentOverride(agentId)
  if (override) return override
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
