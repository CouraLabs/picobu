import type { LoopMessage, LoopMessageMetadata } from "@agent/loop/create-loop.ts"
import { RGBA } from "@opentui/core"
import { getAgent } from "@agent/agents/registry.ts"
import { resolveModelRef } from "@agent/model/resolver.ts"
import { fmtCost, fmtTokens } from "@shared/format.ts"
import { theme } from "@states/theme-state.ts"
import { icons } from "@tui/themes/icons.ts"
import { useTerminalDimensions } from "@opentui/solid"
import type { ProviderModelReasoningEffort } from "@config/options.ts"
import "opentui-spinner/solid"
import { Show } from "solid-js"

export type SessionStatusProps = {
  agentId: string | undefined
  modelKey: string | undefined
  thinking: ProviderModelReasoningEffort | undefined
  messages: LoopMessage[]
  streaming: boolean
}

export const THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const

type UsageWithCost = NonNullable<LoopMessageMetadata["usage"]> & { cost?: number }
type UsageTokenKey = "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens"

const latestUsage = (messages: LoopMessage[]): UsageWithCost | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata as LoopMessageMetadata | undefined
    if (meta?.usage) return { ...meta.usage, cost: meta.cost }
  }
  return undefined
}

const lerpColor = (from: RGBA, to: RGBA, t: number): RGBA => {
  const [r1, g1, b1, a1] = from.toInts();
  const [r2, g2, b2, a2] = to.toInts();
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return RGBA.fromInts(mix(r1, r2), mix(g1, g2), mix(b1, b2), a1);
};

const Sep = () => <text fg={theme().border}>·</text>

const Segment = (props: { icon: string; value: string; valueColor?: string | RGBA }) => (
  <box flexDirection="row" gap={1}>
    <text fg={theme().textMuted} selectable={false}>{props.icon}</text>
    <text fg={props.valueColor ?? theme().text}>{props.value}</text>
  </box>
)

export const SessionStatus = (props: SessionStatusProps) => {
  const agentName = (): string => {
    try {
      return getAgent(props.agentId ?? "").name
    } catch {
      return props.agentId ?? "Agent"
    }
  }

  const agentColor = (): string | RGBA => {
    const color = getAgent(props.agentId ?? "").color
    const t = theme() as unknown as Record<string, unknown>
    return color !== undefined && t[color] instanceof RGBA ? (t[color] as RGBA) : theme().text
  }

  const usage = (): UsageWithCost | undefined => latestUsage(props.messages)

  const dims = useTerminalDimensions()

  const modelLabel = (): string => {
    const full = (() => {
      if (!props.modelKey) return "–"
      try {
        const ref = resolveModelRef(props.modelKey)
        return `${ref.provider.name} ${ref.modelId}`
      } catch {
        return props.modelKey
      }
    })()
    // Reserve room for the telemetry group so the identity truncates first.
    const budget = Math.max(10, dims().width - 4 - agentName().length - thinkingLabel().length - 10 - 52)
    return full.length > budget ? `${full.slice(0, budget - 1)}…` : full
  }

  const tokens = (key: UsageTokenKey): string => {
    const current = usage()
    return current ? fmtTokens(current[key] ?? 0) : "–"
  }

  const contextPercent = (): number | undefined => {
    const current = usage()
    if (!current || !props.modelKey) return undefined
    let context = 0
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context
    } catch {
      return undefined
    }
    if (!context) return undefined
    return Math.min(100, Math.round(((current.inputTokens ?? 0) / context) * 100))
  }

  const contextLabel = (): string => {
    const current = usage()
    if (!current || !props.modelKey) return "–"
    let context = 0
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context
    } catch {
      return "–"
    }
    if (!context) return "–"
    return `${fmtTokens(current.inputTokens ?? 0)}/${fmtTokens(context)}`
  }

  const contextColor = (): string | RGBA => {
    const percent = contextPercent()
    if (percent === undefined) return theme().text
    if (percent >= 85) return theme().error
    if (percent >= 60) return theme().warning
    return theme().text
  }

  const cacheSummary = (): string => {
    const current = usage()
    if (!current) return "–"
    const cacheReadTokens = current.cacheReadTokens ?? 0
    const cacheWriteTokens = current.cacheWriteTokens ?? 0
    const inputTokens = current.inputTokens ?? 0
    const hit = inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 100) : 0
    return `${fmtTokens(cacheReadTokens + cacheWriteTokens)} (${hit}%)`
  }

  const costValue = (): string => {
    const cost = usage()?.cost
    if (cost === undefined) return "–"
    const raw = cost > 0 && cost < 0.01 ? cost.toFixed(4) : fmtCost(cost)
    return raw.startsWith("$") ? raw.slice(1) : raw
  }

  const thinkingLabel = (): string => (props.thinking ? `(${props.thinking})` : "")

  const thinkingColor = (): string | RGBA => {
    const index = THINKING_LEVELS.indexOf(props.thinking as (typeof THINKING_LEVELS)[number])
    if (index < 0) return theme().textMuted
    const t = index / (THINKING_LEVELS.length - 1)
    return lerpColor(theme().textMuted, theme().accent, t)
  }

  return (
    <box flexDirection="row" gap={1} justifyContent="space-between" flexShrink={0} paddingLeft={2} paddingRight={2} overflow="hidden">
      <box flexDirection="row" gap={1} flexShrink={1} overflow="hidden">
        <Show when={props.streaming}>
          <spinner name="dots" color={theme().primary} />
        </Show>
        <text fg={agentColor()} flexShrink={0}>{agentName()}</text>
        <text fg={theme().textMuted} flexShrink={0}>·</text>
        <text fg={theme().textMuted} flexShrink={1} overflow="hidden" wrapMode="none">{modelLabel()}</text>
        <Show when={props.thinking && props.modelKey}>
          <text fg={theme().textMuted} flexShrink={0}>·</text>
          <text fg={thinkingColor()} flexShrink={0}>{thinkingLabel()}</text>
        </Show>
      </box>
      <Sep />
      <box flexDirection="row" gap={1} flexShrink={0}>
        <Segment icon={icons.usage} value={contextLabel()} valueColor={contextColor()} />
        <Sep />
        <Segment icon={icons.arrowDown} value={tokens("inputTokens")} />
        <Sep />
        <Segment icon={icons.arrowUp} value={tokens("outputTokens")} />
        <Sep />
        <Segment icon={icons.refresh} value={cacheSummary()} />
        <Sep />
        <Segment icon={icons.cost} value={costValue()} />
      </box>
    </box>
  )
}
