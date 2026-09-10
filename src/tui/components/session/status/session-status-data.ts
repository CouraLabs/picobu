import { getAgent } from '@agent/agents/registry.ts'
import type { LoopMessage, LoopMessageMetadata } from '@agent/loop/create-loop.ts'
import { projectedContext } from '@agent/model/cost.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import type { SessionUsage } from '@agent/sessions/session.ts'
import type { SessionTotals } from '@agent/sessions/session-meta.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { RGBA } from '@opentui/core'
import { fmtCost, fmtCostPreciseBare, fmtMs, fmtTokens, fmtTps } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { isSpawnTool, isToolPart } from '@tui/components/session/tools/tool-summary.ts'
import { thinkingColor } from './thinking.ts'

export type SessionStatusProps = {
  agentId: string | undefined
  modelKey: string | undefined
  thinking: ProviderModelReasoningEffort | undefined
  title: string | undefined
  cwd: string | undefined
  git: { branch: string; additions: number; deletions: number } | null | undefined
  messages: LoopMessage[]
  totals?: SessionTotals
  usage?: SessionUsage
  streaming: boolean
  queueDepth?: number
  mode?: string
  waiting?: boolean
  mcp?: { connected: number; total: number; tools: number }
}

export type UsageWithCost = NonNullable<LoopMessageMetadata['usage']> & { cost?: number }

export type TokenKey = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens' | 'textTokens' | 'totalTokens'

export type MessageStats = { total: number; tools: number; user: number; assistant: number; compacted: boolean }

export const latestMeta = (messages: LoopMessage[]): LoopMessageMetadata | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata as LoopMessageMetadata | undefined
    if (meta && (meta.usage || meta.finishReason)) return meta
  }
  return undefined
}

export const latestUsage = (messages: LoopMessage[]): UsageWithCost | undefined => {
  const meta = latestMeta(messages)
  return meta?.usage ? { ...meta.usage, cost: meta.cost } : undefined
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
    const t = theme() as unknown as Record<string, unknown>
    return color !== undefined && t[color] instanceof RGBA ? (t[color] as RGBA) : theme().text
  } catch {
    return theme().text
  }
}

export const effectiveTokens = (totals: SessionTotals | undefined, fallback: UsageWithCost | undefined, key: TokenKey): number => {
  const record = totals as unknown as Record<string, number | undefined> | undefined
  if (record && typeof record[key] === 'number') return record[key] as number
  if (fallback && typeof (fallback as unknown as Record<string, number | undefined>)[key] === 'number') return (fallback as unknown as Record<string, number>)[key] as number
  return 0
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

export const getOutputLimit = (modelKey: string | undefined): number | undefined => {
  if (!modelKey) return undefined
  try {
    return resolveModelRef(modelKey).modelMeta.output
  } catch {
    return undefined
  }
}

export const getContextLimit = (modelKey: string | undefined): number | undefined => {
  if (!modelKey) return undefined
  try {
    const context = resolveModelRef(modelKey).modelMeta.context
    return context ? context : undefined
  } catch {
    return undefined
  }
}

export const getContextValue = (totals: SessionTotals | undefined, latest: UsageWithCost | undefined): number => {
  if (totals && (totals.contextTokens > 0 || totals.lastOutputTokens > 0)) return projectedContext(totals)
  if (latest) {
    const projected = projectedContext(latest)
    if (projected > 0) return projected
    if (latest.inputTokens !== undefined) return latest.inputTokens
  }
  return 0
}

export const getContextPercent = (modelKey: string | undefined, contextValue: number): number | undefined => {
  const context = getContextLimit(modelKey)
  if (!context) return undefined
  return Math.min(100, Math.round((contextValue / context) * 100))
}

export const getContextLabel = (modelKey: string | undefined, contextValue: number): string => {
  const context = getContextLimit(modelKey)
  if (!modelKey || !context) return '–'
  return `${fmtTokens(contextValue)}/${fmtTokens(context)}`
}

export const getContextColor = (percent: number | undefined): string | RGBA => {
  if (percent === undefined) return theme().text
  if (percent >= 70) return theme().error
  if (percent >= 50) return theme().warning
  return theme().text
}

export const getInputUiValue = (totals: SessionTotals | undefined, latest: UsageWithCost | undefined): number =>
  Math.max(0, effectiveTokens(totals, latest, 'inputTokens') - effectiveTokens(totals, latest, 'cacheReadTokens') - effectiveTokens(totals, latest, 'cacheWriteTokens'))

export const getCacheSummary = (totals: SessionTotals | undefined, latest: UsageWithCost | undefined): string => {
  const read = effectiveTokens(totals, latest, 'cacheReadTokens')
  const write = effectiveTokens(totals, latest, 'cacheWriteTokens')
  const input = effectiveTokens(totals, latest, 'inputTokens')
  const hit = input > 0 ? Math.round((read / input) * 100) : 0
  return `${fmtTokens(read + write)} (${hit}%)`
}

export const getCostValue = (totals: SessionTotals | undefined, latest: UsageWithCost | undefined, usage: SessionUsage | undefined): string => {
  const cost = totals?.cost ?? latest?.cost ?? usage?.cost
  if (cost === undefined) return '–'
  return fmtCostPreciseBare(cost)
}

export const getCostSplit = (totals: SessionTotals | undefined): string | undefined => {
  const details = totals?.costDetails
  if (!details) return undefined
  const parts: string[] = []
  if (details.inputCost !== undefined) parts.push(`in ${fmtCost(details.inputCost)}`)
  if (details.outputCost !== undefined) parts.push(`out ${fmtCost(details.outputCost)}`)
  if (details.cacheCost !== undefined) parts.push(`cache ${fmtCost(details.cacheCost)}`)
  return parts.length > 0 ? parts.join(' ') : undefined
}

export type ActivityKind = 'prompting' | 'reasoning' | 'tooling' | 'delegating' | 'answering'

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  prompting: 'Prompting',
  reasoning: 'Reasoning',
  tooling: 'Tooling',
  delegating: 'Delegating',
  answering: 'Answering',
}

type ActivityPart = { type?: unknown; state?: unknown; preliminary?: unknown }

const isActiveToolState = (part: ActivityPart): boolean => {
  if (part.preliminary === true && part.state === 'output-available') return true
  switch (part.state) {
    case 'output-available':
    case 'output-error':
    case 'output-denied':
      return false
    default:
      return true
  }
}

export const getActivity = (messages: LoopMessage[], streaming: boolean | undefined): ActivityKind | undefined => {
  if (!streaming) return undefined
  if (messages.length === 0) return 'prompting'
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant') return 'prompting'
  const parts = last.parts ?? []
  if (parts.length === 0) return 'prompting'
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as ActivityPart
    if (!part || typeof part.type !== 'string') continue
    if (isToolPart(part)) {
      if (isActiveToolState(part)) return isSpawnTool(part) ? 'delegating' : 'tooling'
      continue
    }
    if (part.type === 'reasoning') {
      if (part.state === 'streaming') return 'reasoning'
      continue
    }
    if (part.type === 'text' && part.state === 'streaming') return 'answering'
  }
  return 'prompting'
}

export const getFinishReason = (meta: LoopMessageMetadata | undefined, usage: SessionUsage | undefined, messages?: LoopMessage[], streaming?: boolean): string | undefined => {
  const activity = getActivity(messages ?? [], streaming)
  if (activity) return ACTIVITY_LABELS[activity]
  return meta?.finishReason ?? usage?.finishReason
}

export const getFinishColor = (reason: string | undefined): string | RGBA => {
  switch (reason) {
    case ACTIVITY_LABELS.prompting:
      return theme().info
    case ACTIVITY_LABELS.reasoning:
      return theme().secondary
    case ACTIVITY_LABELS.tooling:
      return theme().primary
    case ACTIVITY_LABELS.delegating:
      return theme().accent
    case ACTIVITY_LABELS.answering:
      return theme().success
    case 'stop':
      return theme().success
    case 'tool-calls':
      return theme().info
    case 'length':
      return theme().warning
    case 'error':
    case 'content-filter':
      return theme().error
    default:
      return theme().textMuted
  }
}

export const getTpsLabel = (usage: SessionUsage | undefined, meta: LoopMessageMetadata | undefined): string => fmtTps(usage?.tps ?? meta?.tps)

export const getTtftLabel = (usage: SessionUsage | undefined, meta: LoopMessageMetadata | undefined): string => fmtMs(usage?.ttftMs ?? meta?.ttftMs)

export const getOutputWithLimit = (totals: SessionTotals | undefined, latest: UsageWithCost | undefined, modelKey: string | undefined): string => {
  const out = effectiveTokens(totals, latest, 'outputTokens')
  const limit = getOutputLimit(modelKey)
  return limit ? `${fmtTokens(out)}/${fmtTokens(limit)}` : fmtTokens(out)
}

export const getRunAttribution = (totals: SessionTotals | undefined): string | undefined => {
  const details = totals?.costDetails?.details
  if (!details || details.length === 0) return undefined
  const runs = details.filter((d) => d.source === 'run').length
  const subs = details.filter((d) => d.source === 'subagent')
  if (subs.length === 0) return `${runs} runs`
  const subCost = subs.reduce((sum, d) => sum + (d.cost ?? 0), 0)
  return `${runs} runs · ${subs.length} sub ${fmtCost(subCost)}`
}

export const getMessageStats = (messages: LoopMessage[]): MessageStats => {
  let tools = 0
  let user = 0
  let assistant = 0
  let compacted = false
  for (const m of messages) {
    if (m.role === 'user') user += 1
    if (m.role === 'assistant') assistant += 1
    const md = m.metadata as LoopMessageMetadata | undefined
    if (md?.compaction) compacted = true
    for (const part of m.parts ?? []) {
      if (isToolPart(part)) tools += 1
    }
  }
  return { total: messages.length, tools, user, assistant, compacted }
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
  const parts: string[] = []
  if (mode && mode !== 'normal') parts.push(mode)
  if ((queueDepth ?? 0) > 0) parts.push(`On queue ${queueDepth}`)
  if (waiting) parts.push('waiting')
  return parts.length > 0 ? parts.join(' ') : undefined
}

export type SessionStatusData = {
  msgUsage: () => UsageWithCost | undefined
  meta: () => LoopMessageMetadata | undefined
  activity: () => ActivityKind | undefined
  agentName: () => string
  agentColor: () => string | RGBA
  effective: (key: TokenKey) => number
  modelLabel: () => string
  contextValue: () => number
  contextPercent: () => number | undefined
  contextLabel: () => string
  contextColor: () => string | RGBA
  inputUiValue: () => number
  cacheSummary: () => string
  costValue: () => string
  costSplit: () => string | undefined
  finishReason: () => string | undefined
  finishColor: () => string | RGBA
  tpsLabel: () => string
  ttftLabel: () => string
  outputWithLimit: () => string
  runAttribution: () => string | undefined
  stats: () => MessageStats
  thinkingLabel: () => string
  thinkingColor: () => string | RGBA
  folderLabel: () => string
  gitLabel: () => string
  diffLabel: () => { added: string; removed: string }
  queueLabel: () => string | undefined
}

export const createSessionStatusData = (props: SessionStatusProps): SessionStatusData => {
  const msgUsage = () => latestUsage(props.messages)
  const meta = () => latestMeta(props.messages)
  const activity = () => getActivity(props.messages, props.streaming)
  const effective = (key: TokenKey) => effectiveTokens(props.totals, msgUsage(), key)
  const contextValue = () => getContextValue(props.totals, msgUsage())
  const contextPercent = () => getContextPercent(props.modelKey, contextValue())
  return {
    msgUsage,
    meta,
    activity,
    agentName: () => getAgentName(props.agentId),
    agentColor: () => getAgentColor(props.agentId),
    effective,
    modelLabel: () => getModelLabel(props.modelKey),
    contextValue,
    contextPercent,
    contextLabel: () => getContextLabel(props.modelKey, contextValue()),
    contextColor: () => getContextColor(contextPercent()),
    inputUiValue: () => Math.max(0, effective('inputTokens') - effective('cacheReadTokens') - effective('cacheWriteTokens')),
    cacheSummary: () => getCacheSummary(props.totals, msgUsage()),
    costValue: () => getCostValue(props.totals, msgUsage(), props.usage),
    costSplit: () => getCostSplit(props.totals),
    finishReason: () => getFinishReason(meta(), props.usage, props.messages, props.streaming),
    finishColor: () => getFinishColor(getFinishReason(meta(), props.usage, props.messages, props.streaming)),
    tpsLabel: () => getTpsLabel(props.usage, meta()),
    ttftLabel: () => getTtftLabel(props.usage, meta()),
    outputWithLimit: () => getOutputWithLimit(props.totals, msgUsage(), props.modelKey),
    runAttribution: () => getRunAttribution(props.totals),
    stats: () => getMessageStats(props.messages),
    thinkingLabel: () => getThinkingLabel(props.thinking),
    thinkingColor: () => getThinkingColor(props.thinking),
    folderLabel: () => getFolderLabel(props.cwd),
    gitLabel: () => getGitLabel(props.git),
    diffLabel: () => getDiffLabel(props.git),
    queueLabel: () => getQueueLabel(props.mode, props.queueDepth, props.waiting),
  }
}
