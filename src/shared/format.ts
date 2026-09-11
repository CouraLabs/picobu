export const clip = (value: string, max: number): string => {
  if (max <= 0) return ''
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export const relTime = (ms: number): string => {
  const diff = Date.now() - ms
  if (diff <= 0) return 'just now'
  const min = Math.max(1, Math.round(diff / 60_000))
  if (min < 60) return `${min}m`
  if (min < 24 * 60) return `${Math.round(min / 60)}h`
  return `${Math.round(min / (24 * 60))}d`
}

export const fmtTokens = (n: number): string => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`
  }
  if (n >= 1_000) {
    const k = n / 1_000
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`
  }
  return String(n)
}

export const fmtCost = (n?: number): string => {
  if (n === undefined) return ''
  if (Number.isInteger(n)) return `$${n}`
  return `$${n.toFixed(2)}`
}

export const fmtCostPrecise = (n?: number): string => {
  if (n === undefined) return ''
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`
  return fmtCost(n)
}

export const fmtCostPreciseBare = (n?: number): string => {
  const formatted = fmtCostPrecise(n)
  return formatted.startsWith('$') ? formatted.slice(1) : formatted
}

export const fmtMs = (ms: number | undefined): string => {
  if (ms === undefined) return '–'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export const fmtTps = (tps: number | undefined): string => {
  if (tps === undefined || !Number.isFinite(tps)) return '–'
  if (tps < 10) return `${tps.toFixed(1)}t/s`
  return `${Math.round(tps)}t/s`
}

export const fmtRate = (rate: number | undefined): string => {
  if (rate === undefined) return '0/M'
  return `$${rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(2)}/M`
}

export const tableCell = (value: string, width: number): string => clip(value, width).padEnd(width)

export const fmtDuration = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const fmtRunSummary = (elapsedSec: number, outputTokens: number | null, cost: number | null): string | null => {
  const parts: string[] = []
  if (elapsedSec >= 1) parts.push(fmtDuration(elapsedSec))
  if (outputTokens !== null && outputTokens > 0) parts.push(`${fmtTokens(outputTokens)} out`)
  const costLabel = fmtCost(cost ?? undefined)
  if (costLabel) parts.push(costLabel)
  return parts.length ? parts.join(' · ') : null
}
