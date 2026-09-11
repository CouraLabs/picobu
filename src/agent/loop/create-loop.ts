import { getAgent } from '@agent/agents/registry.ts'
import { listSubagents } from '@agent/agents/subagents.ts'
import type { AgentType } from '@agent/agents/types.ts'
import { listSkills } from '@agent/commands/index.ts'
import { resolveModel } from '@agent/model/resolver.ts'
import { loadAgentsMarkdown } from '@agent/prompts/agents-md.ts'
import { buildRulesSection, buildSkillsSection, buildSubagentsSection, generateSystemMessage } from '@agent/prompts/system.ts'
import { listRules } from '@agent/rules/rules.ts'
import { checkpointsPath } from '@agent/sessions/checkpoints.ts'
import { folderKeyFor, sessionTodoFilePath } from '@agent/sessions/session-paths.ts'
import type { SpawnToolContext } from '@agent/tools/flow/spawn.ts'
import { createLocalSandboxSession } from '@agent/tools/sandbox.ts'
import { buildToolSet, toolsInfo } from '@agent/tools/toolset.ts'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { options, type ProviderModelReasoningEffort } from '@config/options.ts'
import { createMcpManager, type McpManager } from '@integrations/mcp/client.ts'
import { renderMcpServerToolsInfo } from '@integrations/mcp/tools-info.ts'
import { describeError } from '@shared/error-report.ts'
import { DirectChatTransport, type InferUITools, isStepCount, type LanguageModel, ToolLoopAgent, type ToolSet, type UIMessage } from 'ai'

export type AiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'provider-default'
export type LoopConfig = {
  agentId: string
  modelKey: string
  thinking: ProviderModelReasoningEffort
  sessionMode?: 'chat' | 'persistent'
  sessionId?: string
  cwd?: string
  sandbox?: boolean
  agentOverride?: AgentType
  subagent?: boolean
  spawn?: SpawnToolContext
}

type LoopCallOptions = { sessionMode?: 'chat' | 'persistent' }

export type LoopMessage = UIMessage<unknown, never, InferUITools<ToolSet>>

export type LoopMessageMetadata = {
  finishReason?: string
  compaction?: CompactionMetadata
}

export type CompactionMetadata = {
  summary: string
  compactedMessageIds: string[]
  createdAt: number
  kind?: 'compact' | 'plan-handoff'
}
export type AgentReasoning = Exclude<AiReasoningEffort, 'max'>
export type Loop = {
  agent: ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>
  transport: DirectChatTransport<LoopCallOptions, ToolSet, Record<string, unknown>, never, LoopMessage>
  mcp: McpManager
}

const hasValidToolCall =
  (...toolNames: string[]) =>
  ({ steps }: { steps: Array<{ toolCalls?: Array<{ toolName: string; invalid?: boolean }> }> }) => {
    const lastStep = steps.at(-1)
    return lastStep?.toolCalls?.some((toolCall) => toolNames.includes(toolCall.toolName) && !toolCall.invalid) ?? false
  }

const initialModel = (modelKey: string): LanguageModel => {
  try {
    return resolveModel(modelKey).model
  } catch (error) {
    console.error('picobu: initial model resolution failed:', error)
    return createOpenAICompatible({ name: 'unconfigured', apiKey: 'pending', baseURL: 'https://api.openai.com/v1' })('no-model')
  }
}

const formatStreamError = (error: unknown): string => {
  const report = describeError(error)
  return report.detail ? `${report.message}\n${report.detail}` : report.message
}
export function createLoop(getConfig: () => LoopConfig): Loop {
  const initialConfig = getConfig()
  const isPersistent = initialConfig.sessionMode === 'persistent'

  const cwd = initialConfig.cwd ?? options.app.cwd

  const toolSet = buildToolSet({
    todoFilePath: initialConfig.sessionId ? sessionTodoFilePath(folderKeyFor(cwd), initialConfig.sessionId) : undefined,
    sessionId: initialConfig.sessionId,
    interactive: !initialConfig.subagent,
    checkpointsPath: initialConfig.sessionId ? checkpointsPath(folderKeyFor(cwd), initialConfig.sessionId) : undefined,
    spawn: initialConfig.spawn,
  })

  const mcp = createMcpManager()

  const mcpInfo = async (agentDef: { tools: string[] }): Promise<string> => {
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
  const loopAgent = new ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>({
    model: initialModel(initialConfig.modelKey),
    tools: toolSet.getToolSet(),
    prepareCall: async ({ options, ...rest }) => {
      const persistent = options?.sessionMode === 'persistent'
      const config = getConfig()
      const agentDef = config.agentOverride ?? getAgent(persistent ? 'persistent' : config.agentId)
      const resolved = resolveModel(config.modelKey)

      const mcpTools = await mcp.tools()
      const base = {
        ...rest,
        model: resolved.model,
        tools: { ...toolSet.getToolSet(), ...mcpTools },
        activeTools: agentDef.tools.length ? agentDef.tools : undefined,
        instructions: await buildSystem(persistent ? 'persistent' : config.agentId),
        reasoning: config.thinking as unknown as AgentReasoning,
        providerOptions: {
          cacheControl: { type: 'ephemeral', ttl: '1h' },
        },
        ...(agentDef.temperature !== undefined ? { temperature: agentDef.temperature } : {}),
        ...(agentDef.topP !== undefined ? { topP: agentDef.topP } : {}),
        ...(agentDef.topK !== undefined ? { topK: agentDef.topK } : {}),
      }

      const blocking: string[] = config.subagent ? [] : ['ask', 'plan-write', 'plan-exit']
      const stopWhen = blocking.length ? [isStepCount(100), hasValidToolCall(...blocking)] : [isStepCount(100)]

      if (!persistent) return { ...base, stopWhen }
      const allMessages = Array.isArray(rest.prompt) ? rest.prompt : []
      const persistentIndex = allMessages.map((m) => m.role).lastIndexOf('user')
      return {
        ...base,
        prompt: persistentIndex >= 0 ? allMessages.slice(persistentIndex) : rest.prompt,
        stopWhen: [isStepCount(100), hasValidToolCall('ask', 'plan-write', 'plan-exit')],
      }
    },
  })

  const sandboxSession = initialConfig.sandbox === false ? undefined : createLocalSandboxSession(cwd, options.app.shell)
  const agent = sandboxSession
    ? ({
        get id() {
          return loopAgent.id
        },
        get tools() {
          return loopAgent.tools
        },
        stream: (callOptions: Parameters<typeof loopAgent.stream>[0]) => loopAgent.stream({ ...callOptions, experimental_sandbox: sandboxSession }),
        generate: (callOptions: Parameters<typeof loopAgent.generate>[0]) => loopAgent.generate({ ...callOptions, experimental_sandbox: sandboxSession }),
      } as ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>)
    : loopAgent

  const transport = new DirectChatTransport({
    agent,
    options: { sessionMode: isPersistent ? 'persistent' : 'chat' },
    sendFinish: true,
    sendReasoning: true,
    sendSources: true,
    sendStart: true,

    onError: formatStreamError,

    messageMetadata: (opts) => {
      if (opts.part.type === 'start') {
        return undefined
      }

      if (opts.part.type === 'finish-step') {
        console.log('finish-step', opts.part.usage)
      }

      if (opts.part.type === 'finish') {
        console.log('finish', opts.part.totalUsage)
      }

      return undefined
    },
  })
  return { agent, transport, mcp }
}
