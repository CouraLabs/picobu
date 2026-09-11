import type { ProviderModelBilling } from '@config/options.ts'
import type { LanguageModelUsage } from 'ai'

export type StepCost = {
  input: number
  output: number
  cache: number
  total: number
}

export const zeroCost = (): StepCost => ({ input: 0, output: 0, cache: 0, total: 0 })

export const emptyUsage = (): LanguageModelUsage => ({
  inputTokens: 0,
  inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 0,
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  totalTokens: 0,
})

const num = (value: number | undefined): number => value ?? 0

export const calcStepCost = (usage: LanguageModelUsage, billing?: ProviderModelBilling): StepCost => {
  const cacheRead = num(usage.inputTokenDetails?.cacheReadTokens)
  const cacheWrite = num(usage.inputTokenDetails?.cacheWriteTokens)
  const totalInput = num(usage.inputTokens)
  const noCache = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, totalInput - cacheRead - cacheWrite)
  const outputTokens = num(usage.outputTokens)
  const input = (noCache / 1_000_000) * (billing?.input ?? 0)
  const cache = (cacheRead / 1_000_000) * (billing?.cacheRead ?? 0) + (cacheWrite / 1_000_000) * (billing?.cacheWrite ?? 0)
  const output = (outputTokens / 1_000_000) * (billing?.output ?? 0)
  return { input, output, cache, total: input + cache + output }
}

export const sumUsage = (a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage => ({
  inputTokens: num(a.inputTokens) + num(b.inputTokens),
  inputTokenDetails: {
    noCacheTokens: num(a.inputTokenDetails?.noCacheTokens) + num(b.inputTokenDetails?.noCacheTokens),
    cacheReadTokens: num(a.inputTokenDetails?.cacheReadTokens) + num(b.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: num(a.inputTokenDetails?.cacheWriteTokens) + num(b.inputTokenDetails?.cacheWriteTokens),
  },
  outputTokens: num(a.outputTokens) + num(b.outputTokens),
  outputTokenDetails: {
    textTokens: num(a.outputTokenDetails?.textTokens) + num(b.outputTokenDetails?.textTokens),
    reasoningTokens: num(a.outputTokenDetails?.reasoningTokens) + num(b.outputTokenDetails?.reasoningTokens),
  },
  totalTokens: num(a.totalTokens) + num(b.totalTokens),
})

export const addCosts = (a: StepCost, b: StepCost): StepCost => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache: a.cache + b.cache,
  total: a.total + b.total,
})
