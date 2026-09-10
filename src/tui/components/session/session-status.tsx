import { getAgent } from '@agent/agents/registry.ts'
import type { LoopMessage, LoopMessageMetadata } from '@agent/loop/create-loop.ts'
import { projectedContext } from '@agent/model/cost.ts'
import { resolveModelRef } from '@agent/model/resolver.ts'
import type { SessionUsage } from '@agent/sessions/session.ts'
import type { SessionTotals } from '@agent/sessions/session-meta.ts'
import type { ProviderModelReasoningEffort } from '@config/options.ts'
import { RGBA } from '@opentui/core'
import { fmtCost, fmtTokens } from '@shared/format.ts'
import { theme } from '@states/theme-state.ts'
import { isToolPart } from '@tui/components/session/tools/tool-summary.ts'
import { icons } from '@tui/themes/icons.ts'
import 'opentui-spinner/solid'
import { Show } from 'solid-js'

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

export const THINKING_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const

type UsageWithCost = NonNullable<LoopMessageMetadata['usage']> & { cost?: number }

const latestMeta = (messages: LoopMessage[]): LoopMessageMetadata | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata as LoopMessageMetadata | undefined
    if (meta && (meta.usage || meta.finishReason)) return meta
  }
  return undefined
}

const latestUsage = (messages: LoopMessage[]): UsageWithCost | undefined => {
  const meta = latestMeta(messages)
  return meta?.usage ? { ...meta.usage, cost: meta.cost } : undefined
}

const lerpColor = (from: RGBA, to: RGBA, t: number): RGBA => {
  const [r1, g1, b1, a1] = from.toInts()
  const [r2, g2, b2] = to.toInts()
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t)
  return RGBA.fromInts(mix(r1, r2), mix(g1, g2), mix(b1, b2), a1)
}

const Sep = (props: { sep?: string }) => (
  <text
    fg={theme().border}
    flexShrink={0}
    selectable={false}>
    {props.sep ? props.sep : icons.boxVertical}
  </text>
)

const Segment = (props: { icon: string; label?: string; value: string; valueColor?: string | RGBA }) => (
  <box
    flexDirection="row"
    gap={1}
    flexShrink={0}>
    <text
      fg={props.valueColor ?? theme().text}
      selectable={false}>
      {props.icon}
    </text>
    <Show when={props.label}>
      <text
        fg={theme().textMuted}
        selectable={false}>
        {props.label}
      </text>
    </Show>
    <text fg={theme().textMuted}>{props.value}</text>
  </box>
)

const contextBar = (percent: number | undefined): string => {
  if (percent === undefined) return '──────────'
  const cells = 10
  const filled = Math.round((Math.min(100, percent) / 100) * cells)
  return `${icons.blockFull.repeat(filled)}${icons.blockLight.repeat(cells - filled)}`
}

const fmtMs = (ms: number | undefined): string => {
  if (ms === undefined) return '–'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

const fmtTps = (tps: number | undefined): string => {
  if (tps === undefined || !Number.isFinite(tps)) return '–'
  if (tps < 10) return `${tps.toFixed(1)}t/s`
  return `${Math.round(tps)} t/s`
}

const stripDollar = (formatted: string): string => (formatted.startsWith('$') ? formatted.slice(1) : formatted)

export const SessionStatus = (props: SessionStatusProps) => {
  const agentName = (): string => {
    try {
      return getAgent(props.agentId ?? '').name
    } catch {
      return props.agentId ?? 'Agent'
    }
  }

  const agentColor = (): string | RGBA => {
    try {
      const color = getAgent(props.agentId ?? '').color
      const t = theme() as unknown as Record<string, unknown>
      return color !== undefined && t[color] instanceof RGBA ? (t[color] as RGBA) : theme().text
    } catch {
      return theme().text
    }
  }

  const msgUsage = (): UsageWithCost | undefined => latestUsage(props.messages)
  const meta = (): LoopMessageMetadata | undefined => latestMeta(props.messages)

  const effective = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens' | 'textTokens' | 'totalTokens'): number => {
    const totals = props.totals as unknown as Record<string, number | undefined> | undefined
    if (totals && typeof totals[key] === 'number') return totals[key] as number
    const current = msgUsage()
    if (current && typeof (current as unknown as Record<string, number | undefined>)[key] === 'number') return (current as unknown as Record<string, number>)[key] as number
    return 0
  }

  const modelLabel = (): string => {
    if (!props.modelKey) return '–'
    try {
      const ref = resolveModelRef(props.modelKey)
      return `${ref.provider.name ?? ref.provider.id} ${ref.modelMeta?.name ?? ref.modelId}`
    } catch {
      return props.modelKey
    }
  }

  const outputLimit = (): number | undefined => {
    if (!props.modelKey) return undefined
    try {
      return resolveModelRef(props.modelKey).modelMeta.output
    } catch {
      return undefined
    }
  }

  const contextValue = (): number => {
    if (props.totals && (props.totals.contextTokens > 0 || props.totals.lastOutputTokens > 0)) return projectedContext(props.totals)
    const latest = msgUsage()
    if (latest) {
      const projected = projectedContext(latest)
      if (projected > 0) return projected
      if (latest.inputTokens !== undefined) return latest.inputTokens
    }
    return 0
  }

  const contextPercent = (): number | undefined => {
    if (!props.modelKey) return undefined
    let context = 0
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context
    } catch {
      return undefined
    }
    if (!context) return undefined
    return Math.min(100, Math.round((contextValue() / context) * 100))
  }

  const contextLabel = (): string => {
    if (!props.modelKey) return '–'
    let context = 0
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context
    } catch {
      return '–'
    }
    if (!context) return '–'
    return `${fmtTokens(contextValue())}/${fmtTokens(context)}`
  }

  const contextColor = (): string | RGBA => {
    const percent = contextPercent()
    if (percent === undefined) return theme().text
    if (percent >= 70) return theme().error
    if (percent >= 50) return theme().warning
    return theme().text
  }

  const inputUiValue = (): number => Math.max(0, effective('inputTokens') - effective('cacheReadTokens') - effective('cacheWriteTokens'))

  const cacheSummary = (): string => {
    const read = effective('cacheReadTokens')
    const write = effective('cacheWriteTokens')
    const input = effective('inputTokens')
    const hit = input > 0 ? Math.round((read / input) * 100) : 0
    return `${fmtTokens(read + write)} ${hit}%`
  }

  const costValue = (): string => {
    const cost = props.totals?.cost ?? msgUsage()?.cost ?? props.usage?.cost
    if (cost === undefined) return '–'
    const raw = cost > 0 && cost < 0.01 ? cost.toFixed(4) : fmtCost(cost)
    return stripDollar(raw)
  }

  const costSplit = (): string | undefined => {
    const details = props.totals?.costDetails
    if (!details) return undefined
    const parts: string[] = []
    if (details.inputCost !== undefined) parts.push(`i ${stripDollar(fmtCost(details.inputCost))}`)
    if (details.outputCost !== undefined) parts.push(`o ${stripDollar(fmtCost(details.outputCost))}`)
    if (details.cacheCost !== undefined) parts.push(`c ${stripDollar(fmtCost(details.cacheCost))}`)
    return parts.length > 0 ? parts.join(' ') : undefined
  }

  const finishReason = (): string | undefined => meta()?.finishReason ?? props.usage?.finishReason

  const finishColor = (): string | RGBA => {
    switch (finishReason()) {
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

  const _totalTokens = (): string => fmtTokens(effective('totalTokens') || effective('inputTokens') + effective('outputTokens'))

  const _reasoningLabel = (): string => fmtTokens(effective('reasoningTokens'))

  const tpsLabel = (): string => fmtTps(props.usage?.tps ?? meta()?.tps)

  const ttftLabel = (): string => fmtMs(props.usage?.ttftMs ?? meta()?.ttftMs)

  const outputWithLimit = (): string => {
    const out = effective('outputTokens')
    const limit = outputLimit()
    return limit ? `${fmtTokens(out)}/${fmtTokens(limit)}` : fmtTokens(out)
  }

  const runAttribution = (): string | undefined => {
    const details = props.totals?.costDetails?.details
    if (!details || details.length === 0) return undefined
    const runs = details.filter((d) => d.source === 'run').length
    const subs = details.filter((d) => d.source === 'subagent')
    if (subs.length === 0) return `${runs} runs`
    const subCost = subs.reduce((sum, d) => sum + (d.cost ?? 0), 0)
    return `${runs} runs · ${subs.length} sub ${stripDollar(fmtCost(subCost))}`
  }

  const messageStats = (): { total: number; tools: number; user: number; assistant: number; compacted: boolean } => {
    let tools = 0
    let user = 0
    let assistant = 0
    let compacted = false
    for (const m of props.messages) {
      if (m.role === 'user') user += 1
      if (m.role === 'assistant') assistant += 1
      const md = m.metadata as LoopMessageMetadata | undefined
      if (md?.compaction) compacted = true
      for (const part of m.parts ?? []) {
        if (isToolPart(part)) tools += 1
      }
    }
    return { total: props.messages.length, tools, user, assistant, compacted }
  }

  const thinkingLabel = (): string => (props.thinking ? `${props.thinking}` : '')

  const thinkingColor = (): string | RGBA => {
    const index = THINKING_LEVELS.indexOf(props.thinking as (typeof THINKING_LEVELS)[number])
    if (index < 0) return theme().textMuted
    const t = index / (THINKING_LEVELS.length - 1)
    return lerpColor(theme().textMuted, theme().accent, t)
  }

  const folderLabel = (): string => {
    const cwd = props.cwd ?? ''
    const parts = cwd.split('/').filter(Boolean)
    return parts.length > 0 ? (parts[parts.length - 1] as string) : cwd
  }

  const gitLabel = (): string => props.git?.branch ?? '–'

  const diffLabel = (): { added: string; removed: string } => ({
    added: `+${props.git?.additions ?? 0}`,
    removed: `-${props.git?.deletions ?? 0}`,
  })

  const queueLabel = (): string | undefined => {
    const parts: string[] = []
    if (props.mode && props.mode !== 'normal') parts.push(props.mode)
    if ((props.queueDepth ?? 0) > 0) parts.push(`q${props.queueDepth}`)
    if (props.waiting) parts.push('waiting')
    return parts.length > 0 ? parts.join(' ') : undefined
  }

  const stats = (): { total: number; tools: number; user: number; assistant: number; compacted: boolean } => messageStats()

  return (
    <box
      flexDirection="column"
      flexShrink={0}>
      <box
        flexDirection="row"
        gap={1}
        justifyContent="space-between"
        flexShrink={0}
        flexWrap="no-wrap">
        <box
          flexDirection="row"
          gap={1}
          flexShrink={1}
          minWidth={0}
          flexWrap="no-wrap">
          <text
            fg={agentColor()}
            flexShrink={0}>
            {`${icons.command} ${agentName()}`}
          </text>
          <Sep sep={icons.middleDot} />
          <text
            fg={theme().text}
            flexShrink={1}>
            {modelLabel()}
          </text>
          <Show when={props.thinking && props.modelKey}>
            <text
              fg={thinkingColor()}
              flexShrink={0}>
              {'<'}
              {thinkingLabel()}
              {'>'}
            </text>
          </Show>
          <Show when={finishReason()}>
            <Sep sep={icons.middleDot} />
            <text
              fg={finishColor()}
              flexShrink={0}>
              {`${icons.flag} ${finishReason()}`}
            </text>
          </Show>
          <Show when={props.title}>
            <Sep sep={icons.middleDot} />
            <Show when={props.streaming}>
              <spinner
                name="dots12"
                color={theme().accent}
              />
            </Show>
            <text
              fg={theme().text}
              flexShrink={1}>
              {props.title}
            </text>
          </Show>
        </box>
        <Show when={props.streaming && !props.title}>
          <spinner
            name="dots12"
            color={theme().accent}
          />
        </Show>
      </box>
      <box
        flexDirection="row"
        gap={1}
        flexShrink={0}
        flexWrap="wrap">
        <Segment
          icon={icons.usage}
          value={`${contextLabel()} ${contextBar(contextPercent())} ${contextPercent() !== undefined ? `${contextPercent()}%` : ''}`}
          valueColor={contextColor()}
        />
        <Sep sep={icons.middleDot} />
        <Segment
          icon={icons.arrowUp}
          value={fmtTokens(inputUiValue())}
          valueColor={theme().info}
        />
        <Segment
          icon={icons.arrowDown}
          value={outputWithLimit()}
          valueColor={theme().success}
        />
        <Segment
          icon={icons.refresh}
          value={cacheSummary()}
          valueColor={theme().secondary}
        />
        <Sep sep={icons.middleDot} />
        <Segment
          icon={icons.cost}
          value={costValue()}
          valueColor={theme().warning}
        />
        <Show when={costSplit()}>
          <Segment
            icon={icons.info}
            value={costSplit() as string}
          />
        </Show>
        <Sep sep={icons.middleDot} />
        <Segment
          icon={icons.clock}
          value={ttftLabel()}
          valueColor={theme().primary}
        />
        <Segment
          icon={icons.speed}
          value={tpsLabel()}
          valueColor={theme().primary}
        />
      </box>
      <box
        flexDirection="row"
        gap={2}
        flexShrink={0}
        flexWrap="wrap">
        <Segment
          icon={icons.folderOpen}
          value={folderLabel()}
          valueColor={theme().accent}
        />
        <Show when={props.git}>
          <Segment
            icon={icons.gitBranch}
            value={gitLabel()}
            valueColor={theme().secondary}
          />
          <box
            flexDirection="row"
            gap={1}
            flexShrink={0}>
            <text fg={theme().success}>{diffLabel().added}</text>
            <text fg={theme().error}>{diffLabel().removed}</text>
          </box>
        </Show>
        <Segment
          icon={icons.fileText}
          label="msgs"
          value={`${stats().total} (u${stats().user}/a${stats().assistant})`}
        />
        <Segment
          icon={icons.tool}
          label="tools"
          value={`${stats().tools}`}
        />
        <Show when={runAttribution()}>
          <Segment
            icon={icons.star}
            value={runAttribution() as string}
          />
        </Show>
        <Show when={stats().compacted}>
          <Segment
            icon={icons.fileArchive}
            value="compacted"
            valueColor={theme().warning}
          />
        </Show>
        <Show when={props.mcp && props.mcp.total > 0}>
          <Segment
            icon={icons.plug}
            value={`${props.mcp?.connected}/${props.mcp?.total} mcp · ${props.mcp?.tools} tools`}
          />
        </Show>
        <Show when={queueLabel()}>
          <Segment
            icon={icons.bell}
            value={queueLabel() as string}
            valueColor={theme().warning}
          />
        </Show>
      </box>
    </box>
  )
}
