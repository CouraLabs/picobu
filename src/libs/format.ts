/** Clip `value` to `max` chars with a trailing ellipsis when it overflows. */
export const clip = (value: string, max: number): string => {
  if (max <= 0) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
};

/** Compact relative age label, e.g. "5m", "3h", "2d". */
export const relTime = (ms: number): string => {
  const min = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / (24 * 60))}d`;
};

/** Format a token count as a compact human label (e.g. 1_000_000 -> "1M"). */
export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return String(n);
};

/** Format a per-1M-token dollar figure as "$0.40" (trailing zeros trimmed for whole dollars). */
export const fmtCost = (n?: number): string => {
  if (n === undefined) return "";
  const fixed = n.toFixed(2);
  return `$${fixed.replace(/\.00$/, "")}`;
};

/** Format elapsed seconds as a compact timer, e.g. "42s", "1m 02s", "1h 03m". */
export const fmtDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

/** One-line run summary for notifications, e.g. "1m 02s · 12.5K out · $0.03".
 * Null when there is nothing worth reporting (no time, tokens, or cost). */
export const fmtRunSummary = (
  elapsedSec: number,
  outputTokens: number | null,
  cost: number | null,
): string | null => {
  const parts: string[] = [];
  if (elapsedSec >= 1) parts.push(fmtDuration(elapsedSec));
  if (outputTokens !== null && outputTokens > 0) parts.push(`${fmtTokens(outputTokens)} out`);
  const costLabel = fmtCost(cost ?? undefined);
  if (costLabel) parts.push(costLabel);
  return parts.length ? parts.join(" · ") : null;
};
