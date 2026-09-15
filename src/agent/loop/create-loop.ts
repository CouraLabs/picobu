import { createLoopStatsStore } from '@agent/loop/loop-stats.ts'
import { createPrepareCall } from '@agent/loop/prepare-call.ts'
import { resolveInitialModel } from '@agent/loop/resolve-initial-model.ts'
import { withSandbox } from '@agent/loop/sandbox-agent.ts'
import { createSystemBuilder } from '@agent/loop/system-builder.ts'
import { buildToolOrder } from '@agent/loop/tool-order.ts'
import { createLoopTransport } from '@agent/loop/transport.ts'
import type { Loop, LoopCallOptions, LoopConfig } from '@agent/loop/types.ts'
import { fetchProviderEndpoint } from '@agent/model/provider-endpoints.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import { checkpointsPath } from '@agent/sessions/checkpoints.ts'
import { folderKeyFor, sessionTodoFilePath } from '@agent/sessions/session-paths.ts'
import { buildToolSet } from '@agent/tools/toolset.ts'
import { options } from '@config/options.ts'
import { selectStatusLineItems } from '@config/provider-status-line.ts'
import { createMcpManager } from '@integrations/mcp/client.ts'
import { ToolLoopAgent, type ToolSet } from 'ai'

export type { LoopStats, LoopStepCost, LoopStepStats } from '@agent/loop/loop-stats.ts'
export type { AgentReasoning, AiReasoningEffort, Loop, LoopCallOptions, LoopConfig, LoopMessage } from '@agent/loop/types.ts'

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
  const getBilling = () => {
    try {
      return resolveModelRef(getConfig().modelKey).modelMeta.billing
    } catch {
      return undefined
    }
  }
  const statsStore = createLoopStatsStore(getBilling)
  const refreshEndpoints = (): void => {
    let providerId: string | undefined
    try {
      const resolved = resolveModelRef(getConfig().modelKey)
      providerId = resolved.provider.id
      const items = selectStatusLineItems(options.statusLine, providerId)
      const endpoints = items.filter((item) => item.type === 'endpoint')
      if (endpoints.length === 0) return
      const provider = resolved.provider
      void (async () => {
        const values: Record<string, unknown> = {}
        for (const item of endpoints) {
          if (item.type !== 'endpoint') continue
          try {
            values[item.label] = await fetchProviderEndpoint(provider, item.endpoint)
          } catch {}
        }
        if (Object.keys(values).length === 0) return
        try {
          if (resolveModelRef(getConfig().modelKey).provider.id !== providerId) return
        } catch {
          return
        }
        statsStore.setEndpointValues(values)
      })()
    } catch {
      return
    }
  }
  const { buildSystem } = createSystemBuilder({ getConfig, cwd, toolSet, mcp })
  const prepareCall = createPrepareCall({ getConfig, toolSet, mcp, buildSystem })
  const localTools = toolSet.getTools()
  const kindByName = new Map(localTools.map((t) => [t.name, t.kind]))
  const loopAgent = new ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>({
    model: resolveInitialModel(initialConfig.modelKey, initialConfig.sessionId ? { sessionId: initialConfig.sessionId } : undefined),
    tools: toolSet.getToolSet(),
    toolOrder: buildToolOrder(
      localTools.map((t) => t.name),
      (name) => kindByName.get(name),
    ),
    onStepEnd: (event) => statsStore.handleStepEnd(event),
    onStart: () => refreshEndpoints(),
    onEnd: (event) => {
      statsStore.handleEnd(event)
      refreshEndpoints()
    },
    prepareCall,
  })
  const agent = withSandbox(loopAgent, cwd, initialConfig.sandbox !== false)
  const transport = createLoopTransport(agent, isPersistent)
  return { agent, transport, mcp, stats: statsStore.get, onStats: statsStore.onChange, restoreStats: statsStore.restore, refreshEndpoints }
}
