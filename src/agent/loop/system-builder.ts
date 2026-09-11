import { getAgent } from '@agent/agents/registry.ts'
import { listSubagents } from '@agent/agents/subagents.ts'
import { listSkills } from '@agent/commands/index.ts'
import type { LoopConfig } from '@agent/loop/types.ts'
import { loadAgentsMarkdown } from '@agent/prompts/agents-md.ts'
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from '@agent/prompts/system.ts'
import { listRules } from '@agent/rules/rules.ts'
import type { AgentTool } from '@agent/tools/toolset.ts'
import { toolsInfo } from '@agent/tools/toolset.ts'
import { options } from '@config/options.ts'
import type { McpManager } from '@integrations/mcp/client.ts'
import { renderMcpServerToolsInfo } from '@integrations/mcp/tools-info.ts'
import type { ToolSet } from 'ai'

export interface SystemBuilderDeps {
  getConfig: () => LoopConfig
  cwd: string
  toolSet: { getTools: (names?: Array<string>) => Array<AgentTool>; getToolSet: (names?: Array<string>) => ToolSet }
  mcp: McpManager
}

export const createSystemBuilder = (deps: SystemBuilderDeps): { buildSystem: (agentId: string) => Promise<string> } => {
  const { getConfig, cwd, toolSet, mcp } = deps
  const mcpInfo = async (agentDef: { tools: Array<string> }): Promise<string> => {
    const hasMcpTools = agentDef.tools.length === 0 || agentDef.tools.some((name) => name.startsWith('mcp_'))
    if (!hasMcpTools) return ''
    const snapshots = await mcp.snapshot()
    return snapshots
      .map((snapshot) => (snapshot.connected && snapshot.tools.length ? renderMcpServerToolsInfo(snapshot.id, snapshot.instructions ?? snapshot.serverInstructions, snapshot.tools) : ''))
      .filter(Boolean)
      .join('\n\n')
  }
  const systemCache = new Map<string, string>()
  const cacheSystem = (cacheKey: string, built: string): void => {
    if (systemCache.has(cacheKey)) systemCache.delete(cacheKey)
    systemCache.set(cacheKey, built)
    if (systemCache.size > 20) {
      const oldest = systemCache.keys().next().value
      if (oldest !== undefined) systemCache.delete(oldest)
    }
  }
  const buildSystem = async (agentId: string): Promise<string> => {
    const config = getConfig()
    const agent = config.agentOverride ?? getAgent(agentId)
    const skills = listSkills()
    const rules = listRules()
    const subagents = config.spawn ? await listSubagents(cwd) : []
    const agentsAppendix = await loadAgentsMarkdown(cwd)
    const maxAgents = options.harness.maxAgents ?? 4
    const cacheKey = `${agentId}:${cwd}:${mcp.generation}:${JSON.stringify(skills)}:${JSON.stringify(rules)}:${JSON.stringify(subagents)}:${agentsAppendix ?? ''}:${maxAgents}`
    const cached = systemCache.get(cacheKey)
    if (cached !== undefined) return cached
    const hasSkillTool = agent.tools.length === 0 || agent.tools.includes('skill')
    const hasRuleTool = agent.tools.length === 0 || agent.tools.includes('rule')
    const hasSpawnTool = agent.tools.includes('spawn')
    const mcpDocs = await mcpInfo(agent)
    const built = generateSystemMessage({
      appName: options.app.name,
      cwd,
      os: options.app.os,
      shell: options.app.shell,
      agentPrompt: agent.prompt,
      toolsInfo: [toolsInfo(toolSet.getTools(agent.tools)), mcpDocs].filter(Boolean).join('\n'),
      ...(skills.length && hasSkillTool ? { skillsInfo: buildSkillsSection(skills) } : {}),
      ...(rules.length && hasRuleTool ? { rulesInfo: buildRulesSection(rules) } : {}),
      ...(subagents.length && hasSpawnTool ? { subagentsInfo: buildSubagentsSection(subagents, options.harness.maxAgents ?? 4) } : {}),
      ...(agentsAppendix ? { agentsAppendix } : {}),
    })
      .map((s) => `<${s.key}>${s.content}</${s.key}>`)
      .join('\n')
    cacheSystem(cacheKey, built)
    return built
  }
  return { buildSystem }
}
