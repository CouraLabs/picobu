import type { UsageWithCost } from './status-tokens.ts'

export const getCostValue = (_totals?: unknown, _latest?: UsageWithCost | undefined, _usage?: unknown): string => '0'

export const getCostSplit = (_totals?: unknown, _latest?: UsageWithCost): string | undefined => undefined

export const getRunAttribution = (_totals?: unknown): string | undefined => undefined
