import { getAgent } from "@agent/agents/registry.ts";
import type { LoopMessage, LoopMessageMetadata } from "@agent/loop/create-loop.ts";
import { resolveModelRef } from "@agent/model/resolver.ts";
import type { SessionTotals } from "@agent/sessions/session-meta.ts";
import type { ProviderModelReasoningEffort } from "@config/options.ts";
import { RGBA } from "@opentui/core";
import { fmtCost, fmtTokens } from "@shared/format.ts";
import { theme } from "@states/theme-state.ts";
import { icons } from "@tui/themes/icons.ts";
import "opentui-spinner/solid";
import { Show } from "solid-js";

export type SessionStatusProps = {
  agentId: string | undefined;
  modelKey: string | undefined;
  thinking: ProviderModelReasoningEffort | undefined;
  title: string | undefined;
  cwd: string | undefined;
  git: { branch: string; additions: number; deletions: number } | null | undefined;
  messages: LoopMessage[];
  totals?: SessionTotals;
  streaming: boolean;
};

export const THINKING_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;

type UsageWithCost = NonNullable<LoopMessageMetadata["usage"]> & { cost?: number };
type UsageTokenKey = "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens";

const latestUsage = (messages: LoopMessage[]): UsageWithCost | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata as LoopMessageMetadata | undefined;
    if (meta?.usage) return { ...meta.usage, cost: meta.cost };
  }
  return undefined;
};

const lerpColor = (from: RGBA, to: RGBA, t: number): RGBA => {
  const [r1, g1, b1, a1] = from.toInts();
  const [r2, g2, b2] = to.toInts();
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  return RGBA.fromInts(mix(r1, r2), mix(g1, g2), mix(b1, b2), a1);
};

const Sep = () => (
  <text fg={theme().border} flexShrink={0}>
    ·
  </text>
);

const Segment = (props: { icon: string; value: string; valueColor?: string | RGBA }) => (
  <box flexDirection="row" gap={1} flexShrink={0}>
    <text fg={theme().textMuted} selectable={false}>
      {props.icon}
    </text>
    <text fg={props.valueColor ?? theme().text}>{props.value}</text>
  </box>
);

export const SessionStatus = (props: SessionStatusProps) => {
  const agentName = (): string => {
    try {
      return getAgent(props.agentId ?? "").name;
    } catch {
      return props.agentId ?? "Agent";
    }
  };

  const agentColor = (): string | RGBA => {
    try {
      const color = getAgent(props.agentId ?? "").color;
      const t = theme() as unknown as Record<string, unknown>;
      return color !== undefined && t[color] instanceof RGBA ? (t[color] as RGBA) : theme().text;
    } catch {
      return theme().text;
    }
  };

  const usage = (): UsageWithCost | undefined => latestUsage(props.messages);

  const modelLabel = (): string => {
    if (!props.modelKey) return "–";
    try {
      const ref = resolveModelRef(props.modelKey);
      return `${ref.provider.name ?? ref.provider.id} · ${ref.modelMeta?.name ?? ref.modelId}`;
    } catch {
      return props.modelKey;
    }
  };

  const tokens = (key: UsageTokenKey): string => {
    if (props.totals) return fmtTokens(props.totals[key] ?? 0);
    const current = usage();
    return current ? fmtTokens(current[key] ?? 0) : "–";
  };

  const contextPercent = (): number | undefined => {
    const current = usage();
    if (!current || !props.modelKey) return undefined;
    let context = 0;
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context;
    } catch {
      return undefined;
    }
    if (!context) return undefined;
    return Math.min(100, Math.round(((current.inputTokens ?? 0) / context) * 100));
  };

  const contextLabel = (): string => {
    const current = usage();
    if (!current || !props.modelKey) return "–";
    let context = 0;
    try {
      context = resolveModelRef(props.modelKey).modelMeta.context;
    } catch {
      return "–";
    }
    if (!context) return "–";
    return `${fmtTokens(current.inputTokens ?? 0)}/${fmtTokens(context)}`;
  };

  const contextColor = (): string | RGBA => {
    const percent = contextPercent();
    if (percent === undefined) return theme().text;
    if (percent >= 85) return theme().error;
    if (percent >= 60) return theme().warning;
    return theme().text;
  };

  const cacheSummary = (): string => {
    if (props.totals) {
      const cacheReadTokens = props.totals.cacheReadTokens ?? 0;
      const cacheWriteTokens = props.totals.cacheWriteTokens ?? 0;
      const inputTokens = props.totals.inputTokens ?? 0;
      const hit = inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 100) : 0;
      return `${fmtTokens(cacheReadTokens + cacheWriteTokens)} (${hit}%)`;
    }
    const current = usage();
    if (!current) return "–";
    const cacheReadTokens = current.cacheReadTokens ?? 0;
    const cacheWriteTokens = current.cacheWriteTokens ?? 0;
    const inputTokens = current.inputTokens ?? 0;
    const hit = inputTokens > 0 ? Math.round((cacheReadTokens / inputTokens) * 100) : 0;
    return `${fmtTokens(cacheReadTokens + cacheWriteTokens)} (${hit}%)`;
  };

  const costValue = (): string => {
    const cost = props.totals?.cost ?? usage()?.cost;
    if (cost === undefined) return "–";
    const raw = cost > 0 && cost < 0.01 ? cost.toFixed(4) : fmtCost(cost);
    return raw.startsWith("$") ? raw.slice(1) : raw;
  };

  const thinkingLabel = (): string => (props.thinking ? `(${props.thinking})` : "");

  const thinkingColor = (): string | RGBA => {
    const index = THINKING_LEVELS.indexOf(props.thinking as (typeof THINKING_LEVELS)[number]);
    if (index < 0) return theme().textMuted;
    const t = index / (THINKING_LEVELS.length - 1);
    return lerpColor(theme().textMuted, theme().accent, t);
  };

  const folderLabel = (): string => {
    const cwd = props.cwd ?? "";
    const parts = cwd.split("/").filter(Boolean);
    return parts.length > 0 ? (parts[parts.length - 1] as string) : cwd;
  };

  const gitLabel = (): string => props.git?.branch ?? "–";

  const diffLabel = (): { added: string; removed: string } => ({
    added: `+${props.git?.additions ?? 0}`,
    removed: `-${props.git?.deletions ?? 0}`,
  });

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} justifyContent="space-between" flexShrink={0} flexWrap="wrap">
        <box flexDirection="row" gap={1} flexShrink={1} minWidth={0} flexWrap="wrap">
          <text fg={agentColor()} flexShrink={0}>
            {agentName()}
          </text>
          <Sep />
          <text fg={theme().textMuted} flexShrink={1}>
            {modelLabel()}
          </text>
          <Show when={props.thinking && props.modelKey}>
            <Sep />
            <text fg={thinkingColor()} flexShrink={0}>
              {thinkingLabel()}
            </text>
          </Show>
          <Show when={props.title}>
            <Sep />
            <Show when={props.streaming}>
              <spinner name="dots12" color={theme().accent} />
            </Show>
            <text fg={theme().text} flexShrink={1}>
              {props.title}
            </text>
            <Show when={props.streaming}>
              <spinner name="dots12" color={theme().accent} />
            </Show>
          </Show>
        </box>
        <Show when={props.streaming && !props.title}>
          <spinner name="dots12" color={theme().accent} />
        </Show>
        <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
          <Segment icon={icons.usage} value={contextLabel()} valueColor={contextColor()} />
          <Segment icon={icons.arrowUp} value={tokens("inputTokens")} />
          <Segment icon={icons.arrowDown} value={tokens("outputTokens")} />
          <Segment icon={icons.refresh} value={cacheSummary()} />
          <Segment icon={icons.cost} value={costValue()} />
        </box>
      </box>
      <Show when={props.cwd}>
        <box flexDirection="row" gap={1} flexShrink={0} flexWrap="wrap">
          <text fg={theme().textMuted} flexShrink={1}>
            {folderLabel()}
          </text>
          <Show when={props.git}>
            <Sep />
            <text fg={theme().textMuted} flexShrink={0}>
              {gitLabel()}
            </text>
            <text fg={theme().success} flexShrink={0}>
              {diffLabel().added}
            </text>
            <text fg={theme().error} flexShrink={0}>
              {diffLabel().removed}
            </text>
          </Show>
        </box>
      </Show>
    </box>
  );
};
