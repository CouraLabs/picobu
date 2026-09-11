import type { AgentType } from '@agent/agents/types.ts'
import type { LoopStats } from '@agent/loop/loop-stats.ts'
import type { SpawnToolContext } from '@agent/tools/flow/spawn.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import type { McpManager } from '@integrations/mcp/client.ts'
import type { DirectChatTransport, InferUITools, ToolLoopAgent, ToolSet, UIMessage } from 'ai'

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

export type LoopCallOptions = { sessionMode?: 'chat' | 'persistent' }

export type LoopMessage = UIMessage<unknown, never, InferUITools<ToolSet>>

export type AgentReasoning = Exclude<AiReasoningEffort, 'max'>

export type Loop = {
  agent: ToolLoopAgent<LoopCallOptions, ToolSet, Record<string, unknown>, never>
  transport: DirectChatTransport<LoopCallOptions, ToolSet, Record<string, unknown>, never, LoopMessage>
  mcp: McpManager
  stats: () => LoopStats
  onStats: (listener: (stats: LoopStats) => void) => () => void
  restoreStats: (stats: LoopStats) => void
}
