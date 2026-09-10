import type { LanguageModelV2, LanguageModelV3, LanguageModelV4, LanguageModelV4Usage } from '@ai-sdk/provider'
import type { ProviderModelBilling } from '@config/options.ts'
import { fmtTokens } from '@shared/format.ts'
import { type LanguageModelMiddleware, wrapLanguageModel } from 'ai'

export type LoopUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  textTokens?: number
  totalTokens?: number
  noCacheTokens?: number
  contextTokens?: number
  lastOutputTokens?: number
}

export const projectedContext = (usage: Pick<LoopUsage, 'contextTokens' | 'inputTokens' | 'lastOutputTokens' | 'outputTokens'> | undefined): number => {
  if (!usage) return 0
  const context = usage.contextTokens ?? usage.inputTokens ?? 0
  const lastOutput = usage.lastOutputTokens ?? 0
  return context + lastOutput
}

export const computeCost = (usage: LoopUsage, billing?: ProviderModelBilling): number | undefined => {
  if (!billing) return undefined
  const input = Math.max(0, usage.inputTokens ?? 0)
  const output = Math.max(0, usage.outputTokens ?? 0)
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0)
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0)
  const uncached = Math.max(0, input - cacheRead - cacheWrite)
  return ((uncached * (billing.input ?? 0) + output * (billing.output ?? 0) + cacheRead * (billing.cacheRead ?? 0) + cacheWrite * (billing.cacheWrite ?? 0)) / 1_000_000) * (billing.multiplier ?? 1)
}

export const computeCostSplit = (usage: LoopUsage, billing?: ProviderModelBilling): { inputCost: number; outputCost: number; cacheCost: number } | undefined => {
  if (!billing) return undefined
  const input = Math.max(0, usage.inputTokens ?? 0)
  const output = Math.max(0, usage.outputTokens ?? 0)
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0)
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0)
  const uncached = Math.max(0, input - cacheRead - cacheWrite)
  const m = (tokens: number, rate: number | undefined) => ((tokens * (rate ?? 0)) / 1_000_000) * (billing.multiplier ?? 1)
  return {
    inputCost: m(uncached, billing.input),
    outputCost: m(output, billing.output),
    cacheCost: m(cacheRead, billing.cacheRead) + m(cacheWrite, billing.cacheWrite),
  }
}

const toLoopUsage = (usage?: LanguageModelV4Usage | null): LoopUsage => {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const input = usage.inputTokens.total ?? 0
  const output = usage.outputTokens.total ?? 0
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: usage.inputTokens.cacheRead ?? 0,
    cacheWriteTokens: usage.inputTokens.cacheWrite ?? 0,
    reasoningTokens: usage.outputTokens.reasoning ?? 0,
    textTokens: usage.outputTokens.text ?? 0,
    totalTokens: input + output,
    noCacheTokens: usage.inputTokens.noCache ?? 0,
    contextTokens: input,
    lastOutputTokens: output,
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
