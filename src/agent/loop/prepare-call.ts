import { NO_TOOLS } from '@agent/agents/create-agent.ts'
import { getAgent } from '@agent/agents/registry.ts'
import { buildActiveTools } from '@agent/loop/active-tools.ts'
import type { DoomLoopGuard } from '@agent/loop/doom-loop.ts'
import { buildStopWhen } from '@agent/loop/stop-conditions.ts'
import { buildToolOrder } from '@agent/loop/tool-order.ts'
import type { AgentReasoning, LoopCallOptions, LoopConfig } from '@agent/loop/types.ts'
import { copilotProviderToolSet } from '@agent/model/providers/copilot/tools.ts'
import { copilotEndpoint, resolveModel } from '@agent/model/resolver.ts'
import type { AgentTool } from '@agent/tools/toolset.ts'
import { options as appOptions } from '@config/options.ts'
import type { McpManager } from '@integrations/mcp/client.ts'
import type { ModelMessage, ToolLoopAgentSettings, ToolSet } from 'ai'

type PrepareStepArgs = Parameters<NonNullable<ToolLoopAgentSettings<LoopCallOptions, ToolSet, Record<string, unknown>, never>['prepareStep']>>[0]

export interface PrepareCallDeps {
  getConfig: () => LoopConfig
  toolSet: { getTools: (names?: Array<string>) => Array<AgentTool>; getToolSet: (names?: Array<string>) => ToolSet }
  mcp: McpManager
  buildSystem: (agentId: string) => Promise<string>
  doomLoopGuard: DoomLoopGuard
}

export const createPrepareCall = (deps: PrepareCallDeps): ToolLoopAgentSettings<LoopCallOptions, ToolSet, Record<string, unknown>, never>['prepareCall'] => {
  const { getConfig, toolSet, mcp, buildSystem, doomLoopGuard } = deps
  const localKindByName = new Map(toolSet.getTools().map((t) => [t.name, t.kind]))
  return async ({ options, ...rest }) => {
    const persistent = options?.sessionMode === 'persistent'
    const config = getConfig()
    const agentDef = config.agentOverride ?? getAgent(persistent ? 'persistent' : config.agentId)
    const resolved = resolveModel(config.modelKey, config.sessionId ? { sessionId: config.sessionId } : undefined)
    const mcpTools = await mcp.tools()
    const isCopilot = resolved.provider.id === 'github-copilot'
    const copilot = isCopilot ? copilotEndpoint(resolved.modelMeta.endpoint, resolved.modelMeta.npm) : undefined
    const copilotMessages = copilot === 'messages'
    const copilotResponses = copilot === 'responses'
    const copilotEffort = config.thinking === 'none' || config.thinking === 'provider-default' ? undefined : config.thinking
    const declaredNoTools = agentDef.tools.includes(NO_TOOLS)
    const nativeTools = Object.fromEntries(Object.entries(toolSet.getToolSet()).filter(([name]) => !(copilotResponses && name === 'websearch')))
    const copilotTools = copilotResponses && !declaredNoTools ? copilotProviderToolSet() : {}
    const tools = { ...nativeTools, ...copilotTools, ...mcpTools }
    const mcpNames = Object.keys(mcpTools)
    const activeTools = [...new Set([...buildActiveTools(agentDef.tools, [...Object.keys(nativeTools), ...Object.keys(copilotTools)], mcpNames), ...Object.keys(copilotTools)])]
    const base = {
      ...rest,
      model: resolved.model,
      tools,
      toolOrder: buildToolOrder(Object.keys(tools), (name) => localKindByName.get(name) ?? 'mcp'),
      activeTools,
      instructions: await buildSystem(persistent ? 'persistent' : config.agentId),
      reasoning: config.thinking as AgentReasoning,
      providerOptions: {
        anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' }, ...(copilotMessages ? { toolStreaming: false } : {}) },
        ...(copilotResponses && copilotEffort ? { copilot: { reasoningEffort: copilotEffort } } : {}),
      },
      ...(agentDef.temperature !== undefined ? { temperature: agentDef.temperature } : {}),
      ...(agentDef.topP !== undefined ? { topP: agentDef.topP } : {}),
      ...(agentDef.topK !== undefined ? { topK: agentDef.topK } : {}),
    }
    const doomLoopEnabled = appOptions.harness.doomLoop !== false
    const prepareStep = (args: PrepareStepArgs) => {
      if (!doomLoopEnabled) return {}
      const { steer } = doomLoopGuard.observe({
        texts: args.steps.map((step) => step.text),
        toolCalls: args.steps.flatMap((step) => step.toolCalls.map((toolCall) => ({ toolName: toolCall.toolName, input: toolCall.input }))),
      })
      if (!steer) return {}
      return { messages: [...args.messages, { role: 'user', content: steer } as ModelMessage] }
    }
    const stopWhen = buildStopWhen({
      subagent: config.subagent ?? false,
      persistent: persistent ?? false,
      ...(doomLoopEnabled ? { hasHalted: () => doomLoopGuard.isHalted() } : {}),
    })
    if (!persistent) return { ...base, stopWhen, prepareStep }
    const allMessages = Array.isArray(rest.prompt) ? rest.prompt : []
    const persistentIndex = allMessages.map((m) => m.role).lastIndexOf('user')
    return {
      ...base,
      prompt: persistentIndex >= 0 ? allMessages.slice(persistentIndex) : rest.prompt,
      stopWhen,
      prepareStep,
    }
  }
}
