import { getAgent } from '@agent/agents/registry.ts'
import type { LoopMessage, LoopStats } from '@agent/loop/create-loop.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import type { SessionUsage } from '@agent/sessions/session.ts'
import type { TodoItem } from '@agent/tools/flow/todo.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { RGBA } from '@opentui/core'
import { fmtCostPrecise, fmtMs, fmtTokens, fmtTps } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { isToolPart, latestTodoItems } from '@tui/components/session/tools/tool-summary.ts'
import { type ActivityKind, getActivity, getFinishColor, getFinishReason, getResponseTimeLabel, getStepTimeLabel, getToolExecLabel, getTpsLabel, getTtftLabel } from './status-activity.ts'
import { getContextColor, getContextPercent, getContextValue } from './status-context.ts'
import { getCostSplit, getCostValue, getRunAttribution } from './status-cost.ts'
import { getCacheSummary, getInputLabel, getOutputLabel, lastTokensFromMessages, type UsageWithCost } from './status-tokens.ts'
import { thinkingColor } from './thinking.ts'

export interface SessionStatusProps {
  agentId: string | undefined
  modelKey: string | undefined
  thinking: ProviderModelReasoningEffort | undefined
  title: string | undefined
  cwd: string | undefined
  git: { branch: string; additions: number; deletions: number } | null | undefined
  messages: Array<LoopMessage>
  totals?: unknown
  usage?: SessionUsage
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

export const latestMeta = (messages: Array<LoopMessage>): { finishReason?: string } | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata as { finishReason?: string } | undefined
    if (meta?.finishReason) return meta
  }
  return undefined
}

export const latestUsage = (_messages: Array<LoopMessage>): UsageWithCost | undefined => undefined

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
  msgUsage: () => UsageWithCost | undefined
  meta: () => { finishReason?: string } | undefined
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
  costSplit: () => string | undefined
  finishReason: () => string | undefined
  finishColor: () => string | RGBA
  tpsLabel: () => string
  ttftLabel: () => string
  stepTimeLabel: () => string
  responseTimeLabel: () => string
  toolExecLabel: () => string
  outputLabel: () => string
  runAttribution: () => string | undefined
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
  const msgUsage = () => latestUsage(props.messages)
  const meta = () =>
    props.statsStatus?.finishReason !== undefined || props.statsStatus?.rawFinishReason !== undefined
      ? { finishReason: props.statsStatus.finishReason ?? props.statsStatus.rawFinishReason }
      : latestMeta(props.messages)
  const activity = () => getActivity(props.messages, props.streaming)
  const tokens = () => lastTokensFromMessages(props.messages)
  const contextValue = () => props.statsContext ?? getContextValue(tokens())
  const contextPercent = () => getContextPercent(props.modelKey, contextValue())
  const metricsTotal = () => props.statsMetrics?.total
  const performance = () => props.statsPerformance
  return {
    msgUsage,
    meta,
    activity,
    agentName: () => getAgentName(props.agentId),
    agentColor: () => getAgentColor(props.agentId),
    modelLabel: () => getModelLabel(props.modelKey),
    contextValue,
    contextPercent,
    contextLabel: () => fmtTokens(contextValue()),
    contextColor: () => getContextColor(contextPercent()),
    inputLabel: () => (metricsTotal() ? fmtTokens(metricsTotal()?.usage.inputTokens ?? 0) : getInputLabel(tokens(), props.totals)),
    cacheSummary: () => {
      const usage = metricsTotal()?.usage
      if (!usage) return getCacheSummary(tokens())
      const read = usage.inputTokenDetails?.cacheReadTokens ?? 0
      const total = usage.inputTokens ?? 0
      const percent = total > 0 ? Math.round((read / total) * 100) : 0
      return `${fmtTokens(read)} (${percent}%)`
    },
    costValue: () => (metricsTotal() ? fmtCostPrecise(metricsTotal()?.cost.total) || '0' : getCostValue(props.totals, msgUsage(), props.usage)),
    costSplit: () => getCostSplit(props.totals, msgUsage()),
    finishReason: () => getFinishReason(meta(), props.usage, props.messages, props.streaming),
    finishColor: () => getFinishColor(getFinishReason(meta(), props.usage, props.messages, props.streaming)),
    tpsLabel: () => (performance() ? fmtTps(performance()?.effectiveOutputTokensPerSecond ?? performance()?.outputTokensPerSecond ?? undefined) : getTpsLabel(props.usage, meta())),
    ttftLabel: () => (performance()?.timeToFirstOutputMs !== undefined ? fmtMs(performance()?.timeToFirstOutputMs) : getTtftLabel(props.usage, meta())),
    stepTimeLabel: () => (performance() ? fmtMs(performance()?.stepTimeMs) : getStepTimeLabel(msgUsage())),
    responseTimeLabel: () => (performance() ? fmtMs(performance()?.responseTimeMs) : getResponseTimeLabel(msgUsage())),
    toolExecLabel: () => {
      const entries = performance() ? Object.values(performance()?.toolExecutionMs ?? {}) : []
      if (entries.length === 0) return getToolExecLabel(msgUsage())
      return fmtMs(entries.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0))
    },
    outputLabel: () => (metricsTotal() ? fmtTokens(metricsTotal()?.usage.outputTokens ?? 0) : getOutputLabel(tokens(), props.totals)),
    runAttribution: () => getRunAttribution(props.totals),
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
