import { addCosts, calcStepCost, emptyUsage, type StepCost, zeroCost } from '@agent/loop/loop-cost.ts'
import type { ProviderModelBilling } from '@config/options.ts'
import type { CallWarning, FinishReason, LanguageModelUsage, StepResultPerformance } from 'ai'
import { createSignal } from 'solid-js'

export type LoopStepCost = StepCost

export interface LoopStepStats {
  usage: LanguageModelUsage
  performance: StepResultPerformance
  warnings: Array<CallWarning> | undefined
  headers: Record<string, string> | undefined
  finishReason: FinishReason
}

export interface LoopStats {
  performance: StepResultPerformance | undefined
  warnings: Array<CallWarning> | undefined
  headers: Record<string, string> | undefined
  finishReason: FinishReason | undefined
  endpoints: Record<string, unknown> | undefined
  usage: LanguageModelUsage
  stepCount?: number
  cost: LoopStepCost
  tokenTotals?: { inputTokens: number; outputTokens: number }
}

export interface StepEndInput {
  usage: LanguageModelUsage
  performance: StepResultPerformance
  warnings: Array<CallWarning> | undefined
  response: { headers?: Record<string, string> }
  finishReason: FinishReason
}

export interface EndInput {
  usage: LanguageModelUsage
  finishReason: FinishReason
}

export interface LoopStatsStore {
  get: () => LoopStats
  onChange: (listener: (stats: LoopStats) => void) => () => void
  handleStepEnd: (event: StepEndInput) => void
  handleEnd: (event: EndInput) => void
  addExternal: (cost: StepCost) => void
  setEndpointValues: (values: Record<string, unknown>) => void
  restore: (stats: LoopStats) => void
}

const cloneValue = <TValue>(value: TValue): TValue => {
  try {
    return structuredClone(value)
  } catch (error) {
    console.error('picobu: stats clone failed, falling back to shared references:', error)
    return value
  }
}

export const createLoopStatsStore = (getBilling: () => ProviderModelBilling | undefined): LoopStatsStore => {
  const [stats, setStats] = createSignal<LoopStats>({
    performance: undefined,
    warnings: undefined,
    headers: undefined,
    finishReason: undefined,
    endpoints: undefined,
    usage: emptyUsage(),
    stepCount: 0,
    cost: zeroCost(),
  })

  const listeners = new Set<(stats: LoopStats) => void>()
  const notify = (): void => {
    const next = stats()
    for (const listener of listeners) listener(next)
  }
  return {
    get: () => cloneValue(stats()),
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    handleStepEnd: (event) => {
      const step = cloneValue(event)
      setStats((st) => ({
        ...st,
        stepCount: (st.stepCount ?? 0) + 1,
        finishReason: step.finishReason,
        performance: step.performance,
        warnings: step.warnings,
        headers: step.response?.headers,
        usage: {
          ...step.usage,
          outputTokens: (st.usage?.outputTokens ?? 0) + (step.usage?.outputTokens ?? 0),
          outputTokenDetails: {
            reasoningTokens: (st.usage?.outputTokenDetails?.reasoningTokens ?? 0) + (step.usage?.outputTokenDetails?.reasoningTokens ?? 0),
            textTokens: (st.usage?.outputTokenDetails?.textTokens ?? 0) + (step.usage?.outputTokenDetails?.textTokens ?? 0),
          },
        },
        cost: addCosts(st.cost, calcStepCost(event.usage, getBilling())),
      }))
      notify()
    },
    handleEnd: (event) => {
      setStats((st) => ({
        ...st,
        finishReason: event.finishReason,
        tokenTotals: {
          inputTokens: event.usage.inputTokens ?? 0,
          outputTokens: event.usage.outputTokens ?? 0,
        },
      }))
      notify()
    },
    addExternal: (cost) => {
      setStats((st) => ({
        ...st,
        cost: addCosts(st.cost, cost),
      }))
      notify()
    },
    setEndpointValues: (values) => {
      setStats((st) => ({
        ...st,
        endpoints: {
          ...(st.endpoints ?? {}),
          ...cloneValue(values),
        },
      }))
      notify()
    },
    restore: (next) => {
      const cloned = cloneValue(next)
      setStats((st) => ({
        ...st,
        performance: cloned.performance,
        warnings: cloned.warnings,
        headers: cloned.headers,
        finishReason: cloned.finishReason,
        endpoints: cloned.endpoints,
        stepCount: cloned.stepCount ?? (cloned.usage ? 1 : 0),
        usage: cloned.usage,
        tokenTotals: cloned.tokenTotals,
        cost: cloned.cost,
      }))
      notify()
    },
  }
}
