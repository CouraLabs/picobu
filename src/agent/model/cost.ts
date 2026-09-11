import type { LanguageModelV2, LanguageModelV3, LanguageModelV4, LanguageModelV4Usage } from '@ai-sdk/provider'
import type { ProviderModelBilling } from '@config/options.ts'
import { fmtTokens } from '@shared/format.ts'
import { type LanguageModelMiddleware, type StepResultPerformance, wrapLanguageModel } from 'ai'

export type LoopUsageComputedCost = {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  cacheCost: number
  total: number
}

export type LoopUsageComputed = {
  accNoCacheInputTokens: number
  accOutputTokens: number
  accCacheReadTokens: number
  accCacheWriteTokens: number
  accReasoningTokens: number
  accTextTokens: number
  cost?: LoopUsageComputedCost
}

export type LoopUsagePerformance = {
  effectiveOutputTokensPerSecond: number
  outputTokensPerSecond?: number
  inputTokensPerSecond?: number
  effectiveTotalTokensPerSecond: number
  stepTimeMs: number
  responseTimeMs: number
  toolExecutionMs: Record<string, number>
  timeToFirstOutputMs?: number
  timeBetweenOutputChunksMs?: {
    min: number
    p10: number
    median: number
    avg: number
    p90: number
    max: number
  }
}

export type LoopUsage = {
  inputTokens?: number
  noCacheInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  textTokens?: number
  totalTokens?: number
  performance?: LoopUsagePerformance
  computed?: LoopUsageComputed
}

export const toLoopPerformance = (performance: StepResultPerformance): LoopUsagePerformance => ({
  effectiveOutputTokensPerSecond: performance.effectiveOutputTokensPerSecond,
  ...(performance.outputTokensPerSecond !== undefined ? { outputTokensPerSecond: performance.outputTokensPerSecond } : {}),
  ...(performance.inputTokensPerSecond !== undefined ? { inputTokensPerSecond: performance.inputTokensPerSecond } : {}),
  effectiveTotalTokensPerSecond: performance.effectiveTotalTokensPerSecond,
  stepTimeMs: performance.stepTimeMs,
  responseTimeMs: performance.responseTimeMs,
  toolExecutionMs: { ...performance.toolExecutionMs },
  ...(performance.timeToFirstOutputMs !== undefined ? { timeToFirstOutputMs: performance.timeToFirstOutputMs } : {}),
  ...(performance.timeBetweenOutputChunksMs ? { timeBetweenOutputChunksMs: { ...performance.timeBetweenOutputChunksMs } } : {}),
})

const asNonNegative = (value: unknown): number => {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, n)
}

export const deriveNoCacheInputTokens = (inputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number): number =>
  Math.max(0, asNonNegative(inputTokens) - asNonNegative(cacheReadTokens) - asNonNegative(cacheWriteTokens))

export const zeroComputedCost = (): LoopUsageComputedCost => ({ inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, cacheCost: 0, total: 0 })

export const computeUsageCost = (
  acc: { noCacheInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  billing?: ProviderModelBilling,
): LoopUsageComputedCost | undefined => {
  if (!billing) return undefined
  const multiplier = billing.multiplier ?? 1
  const m = (tokens: number, rate: number | undefined): number => ((Math.max(0, tokens) * (rate ?? 0)) / 1_000_000) * multiplier
  const inputCost = m(acc.noCacheInputTokens, billing.input)
  const outputCost = m(acc.outputTokens, billing.output)
  const cacheReadCost = m(acc.cacheReadTokens, billing.cacheRead)
  const cacheWriteCost = m(acc.cacheWriteTokens, billing.cacheWrite)
  const cacheCost = cacheReadCost + cacheWriteCost
  return { inputCost, outputCost, cacheReadCost, cacheWriteCost, cacheCost, total: inputCost + outputCost + cacheCost }
}

export const nextUsage = (prev: LoopUsage | undefined, step: LoopUsage, billing?: ProviderModelBilling): LoopUsage => {
  const inputTokens = step.inputTokens ?? 0
  const outputTokens = step.outputTokens ?? 0
  const cacheReadTokens = step.cacheReadTokens ?? 0
  const cacheWriteTokens = step.cacheWriteTokens ?? 0
  const reasoningTokens = step.reasoningTokens ?? 0
  const textTokens = step.textTokens ?? 0
  const noCacheInputTokens = step.noCacheInputTokens ?? deriveNoCacheInputTokens(inputTokens, cacheReadTokens, cacheWriteTokens)
  const totalTokens = step.totalTokens ?? inputTokens + outputTokens
  const prevAcc = prev?.computed
  const accNoCacheInputTokens = (prevAcc?.accNoCacheInputTokens ?? 0) + Math.max(0, noCacheInputTokens)
  const accOutputTokens = (prevAcc?.accOutputTokens ?? 0) + Math.max(0, outputTokens)
  const accCacheReadTokens = (prevAcc?.accCacheReadTokens ?? 0) + Math.max(0, cacheReadTokens)
  const accCacheWriteTokens = (prevAcc?.accCacheWriteTokens ?? 0) + Math.max(0, cacheWriteTokens)
  const accReasoningTokens = (prevAcc?.accReasoningTokens ?? 0) + Math.max(0, reasoningTokens)
  const accTextTokens = (prevAcc?.accTextTokens ?? 0) + Math.max(0, textTokens)
  const cost = computeUsageCost({ noCacheInputTokens: accNoCacheInputTokens, outputTokens: accOutputTokens, cacheReadTokens: accCacheReadTokens, cacheWriteTokens: accCacheWriteTokens }, billing)
  return {
    inputTokens,
    noCacheInputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    textTokens,
    totalTokens,
    ...(step.performance ? { performance: step.performance } : {}),
    computed: {
      accNoCacheInputTokens,
      accOutputTokens,
      accCacheReadTokens,
      accCacheWriteTokens,
      accReasoningTokens,
      accTextTokens,
      ...(cost ? { cost } : {}),
    },
  }
}

export const projectedContext = (usage: Pick<LoopUsage, 'totalTokens' | 'inputTokens' | 'outputTokens'> | undefined): number => {
  if (!usage) return 0
  if (usage.totalTokens !== undefined) return Math.max(0, usage.totalTokens)
  return asNonNegative(usage.inputTokens) + asNonNegative(usage.outputTokens)
}

const accFromUsage = (usage: LoopUsage): { noCacheInputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } => {
  const computed = usage.computed
  if (computed) {
    return {
      noCacheInputTokens: computed.accNoCacheInputTokens,
      outputTokens: computed.accOutputTokens,
      cacheReadTokens: computed.accCacheReadTokens,
      cacheWriteTokens: computed.accCacheWriteTokens,
    }
  }
  return {
    noCacheInputTokens: usage.noCacheInputTokens ?? deriveNoCacheInputTokens(usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens),
    outputTokens: asNonNegative(usage.outputTokens),
    cacheReadTokens: asNonNegative(usage.cacheReadTokens),
    cacheWriteTokens: asNonNegative(usage.cacheWriteTokens),
  }
}

export const computeCost = (usage: LoopUsage, billing?: ProviderModelBilling): number | undefined => {
  if (!billing) return undefined
  if (usage.computed?.cost) {
    const recomputed = computeUsageCost(
      {
        noCacheInputTokens: usage.computed.accNoCacheInputTokens,
        outputTokens: usage.computed.accOutputTokens,
        cacheReadTokens: usage.computed.accCacheReadTokens,
        cacheWriteTokens: usage.computed.accCacheWriteTokens,
      },
      billing,
    )
    return recomputed?.total ?? usage.computed.cost.total
  }
  return computeUsageCost(accFromUsage(usage), billing)?.total
}

export const computeCostSplit = (usage: LoopUsage, billing?: ProviderModelBilling): LoopUsageComputedCost | undefined => {
  if (!billing) return undefined
  if (usage.computed) {
    return (
      computeUsageCost(
        {
          noCacheInputTokens: usage.computed.accNoCacheInputTokens,
          outputTokens: usage.computed.accOutputTokens,
          cacheReadTokens: usage.computed.accCacheReadTokens,
          cacheWriteTokens: usage.computed.accCacheWriteTokens,
        },
        billing,
      ) ?? usage.computed.cost
    )
  }
  return computeUsageCost(accFromUsage(usage), billing)
}

const toLoopUsage = (usage?: LanguageModelV4Usage | null): LoopUsage => {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, noCacheInputTokens: 0, totalTokens: 0 }
  const input = usage.inputTokens.total ?? 0
  const output = usage.outputTokens.total ?? 0
  const cacheReadTokens = usage.inputTokens.cacheRead ?? 0
  const cacheWriteTokens = usage.inputTokens.cacheWrite ?? 0
  const reasoningTokens = usage.outputTokens.reasoning ?? 0
  const textTokens = usage.outputTokens.text ?? 0
  return {
    inputTokens: input,
    noCacheInputTokens: deriveNoCacheInputTokens(input, cacheReadTokens, cacheWriteTokens),
    outputTokens: output,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    textTokens,
    totalTokens: input + output,
  }
}

const logCall = (modelKey: string, billing: ProviderModelBilling | undefined, usage: LoopUsage): void => {
  const cost = computeCost(usage, billing)
  console.error(
    [
      `picobu: llm ${modelKey}`,
      `in=${fmtTokens(usage.inputTokens ?? 0)}`,
      `out=${fmtTokens(usage.outputTokens ?? 0)}`,
      `cacheRead=${fmtTokens(usage.cacheReadTokens ?? 0)}`,
      `cacheWrite=${fmtTokens(usage.cacheWriteTokens ?? 0)}`,
      `cost=${cost !== undefined ? `$${cost.toFixed(4)}` : 'n/a'}`,
    ].join(' '),
  )
}

export const costLoggingMiddleware = (modelKey: string, billing?: ProviderModelBilling): LanguageModelMiddleware => ({
  specificationVersion: 'v4',
  wrapGenerate: async ({ doGenerate }) => {
    try {
      const result = await doGenerate()
      logCall(modelKey, billing, toLoopUsage(result.usage))
      return result
    } catch (error) {
      console.error(`picobu: llm ${modelKey} failed:`, error)
      throw error
    }
  },
  wrapStream: async ({ doStream }) => {
    let result: Awaited<ReturnType<typeof doStream>>
    try {
      result = await doStream()
    } catch (error) {
      console.error(`picobu: llm ${modelKey} failed:`, error)
      throw error
    }
    let logged = false
    const logOnce = (usage?: LanguageModelV4Usage | null): void => {
      if (logged) return
      logged = true
      logCall(modelKey, billing, toLoopUsage(usage))
    }
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            if (part.type === 'finish') {
              logOnce((part as { usage?: LanguageModelV4Usage }).usage)
            }
            controller.enqueue(part)
          },
          flush() {
            logOnce(undefined)
          },
        }),
      ),
    }
  },
})

export const withCostLogging = (model: LanguageModelV2 | LanguageModelV3 | LanguageModelV4, modelKey: string, billing?: ProviderModelBilling): LanguageModelV4 =>
  wrapLanguageModel({ model, middleware: costLoggingMiddleware(modelKey, billing) })
