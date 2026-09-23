import { getAgent } from '@agent/agents/registry.ts'
import type { DoomLoopGuard } from '@agent/loop/doom-loop.ts'
import { buildStopWhen } from '@agent/loop/stop-conditions.ts'
import { buildToolOrder } from '@agent/loop/tool-order.ts'
import type { AgentReasoning, LoopCallOptions, LoopConfig } from '@agent/loop/types.ts'
import { resolveModel } from '@agent/model/resolver.ts'
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
    const tools = { ...toolSet.getToolSet(), ...mcpTools }
    const base = {
      ...rest,
      model: resolved.model,
      tools,
      toolOrder: buildToolOrder(Object.keys(tools), (name) => localKindByName.get(name) ?? 'mcp'),
      activeTools: agentDef.tools.filter((name) => name in tools),
      instructions: await buildSystem(persistent ? 'persistent' : config.agentId),
      reasoning: config.thinking as AgentReasoning,
      providerOptions: {
        cacheControl: { type: 'ephemeral', ttl: '1h' },
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
