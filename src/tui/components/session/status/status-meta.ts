import { getAgent } from '@agent/agents/registry.ts'
import type { LoopMessage, LoopStats } from '@agent/loop/create-loop.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import type { TodoItem } from '@agent/tools/flow/todo.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { RGBA } from '@opentui/core'
import { fmtCostPrecise, fmtMs, fmtTokens, fmtTps } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { isToolPart, latestTodoItems } from '@tui/components/session/tools/tool-summary.ts'
import { type ActivityKind, getActivity, getFinishColor, getFinishReason } from './status-activity.ts'
import { thinkingColor } from './thinking.ts'

export interface SessionStatusProps {
  agentId: string | undefined
  modelKey: string | undefined
  thinking: ProviderModelReasoningEffort | undefined
  title: string | undefined
  cwd: string | undefined
  git: { branch: string; additions: number; deletions: number } | null | undefined
  messages: Array<LoopMessage>
  streaming: boolean
  queueDepth?: number
  mode?: string
  waiting?: boolean
  mcp?: { connected: number; total: number; tools: number }
  statsStatus?: Pick<LoopStats, 'finishReason' | 'rawFinishReason' | 'warnings' | 'headers'>
  statsPerformance?: LoopStats['performance']
  statsContext?: number
  statsMetrics?: Pick<LoopStats, 'total' | 'currentTotal'> & { stepCount: number }
}

export interface MessageStats {
  total: number
  tools: number
  user: number
  assistant: number
}

export const getAgentName = (agentId: string | undefined): string => {
  try {
    return getAgent(agentId ?? '').name
  } catch {
    return agentId ?? 'Agent'
  }
}

export const getAgentColor = (agentId: string | undefined): string | RGBA => {
  try {
    const color = getAgent(agentId ?? '').color
    const t = theme() as Record<string, unknown>
    return color !== undefined && t[color] instanceof RGBA ? (t[color] as RGBA) : theme().text
  } catch {
    return theme().text
  }
}

export const getModelLabel = (modelKey: string | undefined): string => {
  if (!modelKey) return '–'
  try {
    const ref = resolveModelRef(modelKey)
    return `${ref.provider.name ?? ref.provider.id} ${ref.modelMeta?.name ?? ref.modelId}`
  } catch {
    return modelKey
  }
}

export const getModelContextSize = (modelKey: string | undefined): number => {
  if (!modelKey) return 200000
  try {
    const ref = resolveModelRef(modelKey)
    return ref.modelMeta.context
  } catch {
    return 200000
  }
}

export const getMessageStats = (messages: Array<LoopMessage>): MessageStats => {
  let tools = 0
  let user = 0
  let assistant = 0
  for (const m of messages) {
    if (m.role === 'user') user += 1
    if (m.role === 'assistant') assistant += 1
    for (const part of m.parts ?? []) {
      if (isToolPart(part)) tools += 1
    }
  }
  return { total: messages.length, tools, user, assistant }
}

export const getThinkingLabel = (thinking: ProviderModelReasoningEffort | undefined): string => (thinking ? `${thinking}` : '')

export const getThinkingColor = (thinking: ProviderModelReasoningEffort | undefined): string | RGBA => thinkingColor(thinking)

export const getFolderLabel = (cwd: string | undefined): string => {
  const value = cwd ?? ''
  const parts = value.split('/').filter(Boolean)
  return parts.length > 0 ? (parts[parts.length - 1] as string) : value
}

export const getGitLabel = (git: SessionStatusProps['git']): string => git?.branch ?? '–'

export const getDiffLabel = (git: SessionStatusProps['git']): { added: string; removed: string } => ({
  added: `+${git?.additions ?? 0}`,
  removed: `-${git?.deletions ?? 0}`,
})

export const getQueueLabel = (mode: string | undefined, queueDepth: number | undefined, waiting: boolean | undefined): string | undefined => {
  const parts: Array<string> = []
  if (mode && mode !== 'normal') parts.push(mode)
  if ((queueDepth ?? 0) > 0) parts.push(`On queue ${queueDepth}`)
  if (waiting) parts.push('waiting')
  return parts.length > 0 ? parts.join(' ') : undefined
}

export interface SessionStatusData {
  activity: () => ActivityKind | undefined
  agentName: () => string
  agentColor: () => string | RGBA
  modelLabel: () => string
  contextValue: () => number
  contextPercent: () => number
  contextLabel: () => string
  contextColor: () => string | RGBA
  inputLabel: () => string
  cacheSummary: () => string
  costValue: () => string
  finishReason: () => string | undefined
  finishColor: () => string | RGBA
  tpsLabel: () => string
  ttftLabel: () => string
  stepTimeLabel: () => string
  responseTimeLabel: () => string
  toolExecLabel: () => string
  outputLabel: () => string
  stats: () => MessageStats
  thinkingLabel: () => string
  thinkingColor: () => string | RGBA
  folderLabel: () => string
  gitLabel: () => string
  diffLabel: () => { added: string; removed: string }
  queueLabel: () => string | undefined
  todoItems: () => Array<TodoItem> | undefined
}

export const createSessionStatusData = (props: SessionStatusProps): SessionStatusData => {
  const activity = () => getActivity(props.messages, props.streaming)
  const metricsTotal = () => props.statsMetrics?.currentTotal ?? props.statsMetrics?.total
  const performance = () => props.statsPerformance
  const modelContextSize = () => getModelContextSize(props.modelKey)
  const contextValue = () => metricsTotal()?.usage?.totalTokens ?? 0
  const contextPercent = () => Math.round((contextValue() / modelContextSize()) * 100)
  const contextColor = () => {
    const p = contextPercent()
    if(p > 10 && p < 40) return theme().success
    if(p > 40 && p < 70) return theme().warning
    if(p > 70) return theme().error
    return theme().text
  }

  return {
    activity,
    agentName: () => getAgentName(props.agentId),
    agentColor: () => getAgentColor(props.agentId),
    modelLabel: () => getModelLabel(props.modelKey),
    contextValue,
    contextPercent,
    contextLabel: () => fmtTokens(contextValue()),
    contextColor,
    inputLabel: () => (metricsTotal() ? fmtTokens(metricsTotal()?.usage.inputTokenDetails?.noCacheTokens ?? 0) : '0'),
    cacheSummary: () => {
      const usage = metricsTotal()?.usage
      if (!usage) return `0 (0%)`
      const cache = (usage.inputTokenDetails?.cacheReadTokens ?? 0) + (usage.inputTokenDetails?.cacheWriteTokens ?? 0)
      const total = usage.inputTokens ?? 0
      const percent = total > 0 ? Math.round((cache / total) * 100) : 0
      return `${fmtTokens(cache)} (${percent}%)`
    },
    costValue: () => fmtCostPrecise(metricsTotal()?.cost?.total ?? 0),
    finishReason: () => getFinishReason(props.statsStatus?.finishReason, props.messages, props.streaming),
    finishColor: () => getFinishColor(getFinishReason(props.statsStatus?.finishReason, props.messages, props.streaming)),
    tpsLabel: () => fmtTps(performance()?.effectiveOutputTokensPerSecond ?? performance()?.outputTokensPerSecond ?? undefined),
    ttftLabel: () => fmtMs(performance()?.timeToFirstOutputMs ?? 0),
    stepTimeLabel: () => fmtMs(performance()?.stepTimeMs ?? 0),
    responseTimeLabel: () => fmtMs(performance()?.responseTimeMs ?? 0),
    toolExecLabel: () => {
      const entries = performance() ? Object.values(performance()?.toolExecutionMs ?? {}) : []
      if (entries.length === 0) return "0ms"
      return fmtMs(entries.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0))
    },
    outputLabel: () => fmtTokens(metricsTotal()?.usage.outputTokens ?? 0),
    stats: () => getMessageStats(props.messages),
    thinkingLabel: () => getThinkingLabel(props.thinking),
    thinkingColor: () => getThinkingColor(props.thinking),
    folderLabel: () => getFolderLabel(props.cwd),
    gitLabel: () => getGitLabel(props.git),
    diffLabel: () => getDiffLabel(props.git),
    queueLabel: () => getQueueLabel(props.mode, props.queueDepth, props.waiting),
    todoItems: () => latestTodoItems(props.messages),
  }
}
