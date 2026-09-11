import { addCosts, calcStepCost, emptyUsage, type StepCost, sumUsage, zeroCost } from '@agent/loop/loop-cost.ts'
import type { ProviderModelBilling } from '@config/options.ts'
import type { CallWarning, FinishReason, LanguageModelUsage, StepResultPerformance } from 'ai'

export type LoopStepCost = StepCost

export interface LoopStepStats {
  usage: LanguageModelUsage
  cost: LoopStepCost
  performance: StepResultPerformance
  warnings: Array<CallWarning> | undefined
  headers: Record<string, string> | undefined
  finishReason: FinishReason
  rawFinishReason: string | undefined
}

export interface LoopStats {
  performance: StepResultPerformance | undefined
  warnings: Array<CallWarning> | undefined
  headers: Record<string, string> | undefined
  finishReason: FinishReason | undefined
  rawFinishReason: string | undefined
  steps: Array<LoopStepStats>
  total: { usage: LanguageModelUsage; cost: LoopStepCost }
  currentTotal: { usage: LanguageModelUsage; cost: LoopStepCost }
}

export interface StepEndInput {
  usage: LanguageModelUsage
  performance: StepResultPerformance
  warnings: Array<CallWarning> | undefined
  response: { headers?: Record<string, string> }
  finishReason: FinishReason
  rawFinishReason: string | undefined
}

export interface EndInput {
  usage: LanguageModelUsage
  finishReason: FinishReason
  rawFinishReason: string | undefined
}

export interface LoopStatsStore {
  get: () => LoopStats
  onChange: (listener: (stats: LoopStats) => void) => () => void
  handleStepEnd: (event: StepEndInput) => void
  handleEnd: (event: EndInput) => void
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
  const stats: LoopStats = {
    performance: undefined,
    warnings: undefined,
    headers: undefined,
    finishReason: undefined,
    rawFinishReason: undefined,
    steps: [],
    total: { usage: emptyUsage(), cost: zeroCost() },
    currentTotal: { usage: emptyUsage(), cost: zeroCost() },
  }
  const listeners = new Set<(stats: LoopStats) => void>()
  const snapshot = (): LoopStats => cloneValue(stats)
  const notify = (): void => {
    const next = snapshot()
    for (const listener of listeners) listener(next)
  }
  return {
    get: snapshot,
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    handleStepEnd: (event) => {
      const cost = calcStepCost(event.usage, getBilling())
      const step: LoopStepStats = cloneValue({
        usage: event.usage,
        cost,
        performance: event.performance,
        warnings: event.warnings,
        headers: event.response?.headers,
        finishReason: event.finishReason,
        rawFinishReason: event.rawFinishReason,
      })
      stats.steps.push(step)
      stats.performance = step.performance
      stats.warnings = step.warnings
      stats.headers = step.headers
      stats.currentTotal = { usage: sumUsage(stats.currentTotal.usage, step.usage), cost: addCosts(stats.currentTotal.cost, step.cost) }
      notify()
    },
    handleEnd: (event) => {
      const cost = calcStepCost(event.usage, getBilling())
      stats.total = { usage: sumUsage(stats.total.usage, event.usage), cost: addCosts(stats.total.cost, cost) }
      stats.finishReason = event.finishReason
      stats.rawFinishReason = event.rawFinishReason
      notify()
    },
    restore: (next) => {
      const cloned = cloneValue(next)
      stats.performance = cloned.performance
      stats.warnings = cloned.warnings
      stats.headers = cloned.headers
      stats.finishReason = cloned.finishReason
      stats.rawFinishReason = cloned.rawFinishReason
      stats.steps = cloned.steps
      stats.total = cloned.total
      stats.currentTotal = cloned.currentTotal
      notify()
    },
  }
}
