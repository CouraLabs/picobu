import { basename } from "node:path";
import { useSelector } from "@xstate/store-react";
import { TextAttributes, type RGBA } from "@opentui/core";
import { themeStore } from "../../stores/theme-store";
import { icons } from "../symbols/icons";
import { useGitStatus } from "../../hooks/useGitStatus";
import { options } from "../../libs/options";
import type { Theme } from "../../themes";
import type { ResolvedModel } from "../../harness/agent/factory/provider-resolver";

export type ModelStatusBarProps = {
  agentName: string;
  agentColor: RGBA;
  resolvedModel: ResolvedModel;
  thinking: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  elapsedSec: number;
  ttftMs: number | null;
  tokensPerSec: number | null;
};

/** Format the session timer as `mm:ss`, or `HhMMm` past an hour. */
const formatTimer = (elapsedSec: number): string => {
  const total = Math.max(0, Math.floor(elapsedSec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** Compact a token count: keep values under 1000 verbatim, round larger ones to `k`. */
const toK = (n: number): string => {
  if (n < 1000) return String(n);
  const k = n / 1000;
  const rounded = k >= 10 ? String(Math.round(k)) : k.toFixed(1);
  return `${rounded.replace(/\.0$/, "")}k`;
};

/** Reasoning-effort level → status-bar foreground + text attributes. */
const thinkingStyle = (level: string, theme: Theme): { fg: RGBA; attr?: number } => {
  switch (level.toLowerCase()) {
    case "none":
      return { fg: theme.textMuted, attr: TextAttributes.DIM };
    case "low":
    case "minimal":
      return { fg: theme.textMuted };
    case "medium":
      return { fg: theme.text };
    case "high":
      return { fg: theme.warning, attr: TextAttributes.DIM };
    case "xhigh":
      return { fg: theme.warning, attr: TextAttributes.BOLD };
    case "max":
      return { fg: theme.error, attr: TextAttributes.BOLD };
    default:
      return { fg: theme.text };
  }
};

/** Context-usage foreground: neutral until 50%, warning 50–79%, error from 80%. */
const contextColor = (used: number, total: number, theme: Theme): RGBA => {
  const pct = total > 0 ? (used / total) * 100 : 0;
  if (pct >= 80) return theme.error;
  if (pct >= 50) return theme.warning;
  return theme.text;
};

/**
 * Status bar under the prompt: provider/model, thinking level, context usage,
 * ttft, token throughput, the running session timer, and a project line with
 * the current folder, git branch and working-tree add/delete counts.
 */
export const ModelStatusBar = ({
  agentName,
  agentColor,
  resolvedModel,
  thinking,
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheWriteTokens,
  elapsedSec,
  ttftMs,
  tokensPerSec,
}: ModelStatusBarProps) => {
  const theme = useSelector(themeStore, (s) => s.context.theme);
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  const cacheRead = cacheReadTokens ?? 0;
  const cacheWrite = cacheWriteTokens ?? 0;
  const uncached = Math.max(0, input - cacheRead - cacheWrite);
  const contextUsed = input + output;
  const cachePct = input > 0 ? Math.round((cacheRead / input) * 100) : 0;
  const cacheText = cacheReadTokens !== null ? `${toK(cacheRead)} (${cachePct}%)` : "0";
  const ttftValue = ttftMs !== null ? `${(ttftMs / 1000).toFixed(2)}s` : "0s";
  const tpsValue = tokensPerSec !== null ? `${tokensPerSec.toFixed(1)}` : "0t/s";
  const timeValue = formatTimer(elapsedSec);
  const billing = resolvedModel.modelMeta.billing;
  const cost = billing
    ? ((uncached * (billing.input ?? 0)
      + output * (billing.output ?? 0)
      + cacheRead * (billing.cacheRead ?? 0)
      + cacheWrite * (billing.cacheWrite ?? 0)) / 1_000_000) * (billing.multiplier ?? 1)
    : 0;
  const costValue = `${cost.toFixed(2)}`;
  const { fg: thinkingFg, attr: thinkingAttr } = thinkingStyle(thinking, theme);
  const contextFg = contextColor(contextUsed, resolvedModel.modelMeta.context, theme);

  return (
    <box flexDirection="row" paddingX={1} flexWrap="wrap" gap={1}>
      <text selectable={false} fg={agentColor} attributes={TextAttributes.BOLD}>{agentName}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.text}>{resolvedModel.provider.name} {resolvedModel.modelMeta.name ?? resolvedModel.modelId}</text>
      <text selectable={false} fg={thinkingFg} attributes={thinkingAttr}>({thinking})</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={contextFg}>{icons.context} {toK(contextUsed)}/{toK(resolvedModel.modelMeta.context)}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.success}>{icons.arrows.up} {toK(uncached)}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.info}>{icons.arrows.down} {toK(output)}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.warning}>{icons.cache} {cacheText}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.success}>$ {costValue}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.primary}>{icons.tool} {ttftValue}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.secondary}>{icons.speed} {tpsValue}</text>
      <text selectable={false} fg={theme.textMuted} attributes={TextAttributes.DIM}>·</text>
      <text selectable={false} fg={theme.text}>{icons.time}{timeValue}</text>
    </box>
  );
};