import type { LoopMessage } from '@agent/loop/create-loop.ts'

export type UsageWithCost = {
  finishReason?: string
}

export type NormalizedTokens = {
  prompt: number
  completion: number
  cacheRead: number
  cacheWrite: number
  cacheTotal: number
  total: number
}

export const normalizeUsageTokens = (_raw?: unknown): NormalizedTokens | undefined => undefined

export const lastTokensFromMessages = (_messages: LoopMessage[]): NormalizedTokens | undefined => undefined

export const getInputLabel = (_tokens?: unknown, _totals?: unknown): string => '0'

export const getOutputLabel = (_tokens?: unknown, _totals?: unknown): string => '0'

export const getCacheSummary = (_tokens?: unknown): string => '0 (0%)'
