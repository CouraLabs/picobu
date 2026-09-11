import { describe, expect, test } from 'bun:test'
import type { StepResultPerformance } from 'ai'
import { emptyUsage } from '../../src/agent/loop/loop-cost.ts'
import { createLoopStatsStore, type EndInput, type LoopStats, type StepEndInput } from '../../src/agent/loop/loop-stats.ts'

const performance = (stepTimeMs: number): StepResultPerformance =>
  ({
    stepTimeMs,
    responseTimeMs: stepTimeMs,
    toolExecutionMs: {},
  }) as unknown as StepResultPerformance

const stepEnd = (inputTokens: number, headers?: Record<string, string>): StepEndInput => ({
  usage: { ...emptyUsage(), inputTokens, totalTokens: inputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  performance: performance(inputTokens),
  warnings: undefined,
  response: { headers },
  finishReason: 'stop',
  rawFinishReason: 'stop',
})

const end = (inputTokens: number): EndInput => ({
  usage: { ...emptyUsage(), inputTokens, totalTokens: inputTokens, inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  finishReason: 'stop',
  rawFinishReason: 'stop',
})

describe('createLoopStatsStore', () => {
  test('starts empty with zero totals', () => {
    const store = createLoopStatsStore(() => ({ input: 1, output: 1 }))
    const stats = store.get()
    expect(stats.steps).toEqual([])
    expect(stats.finishReason).toBeUndefined()
    expect(stats.total.cost).toEqual({ input: 0, output: 0, cache: 0, total: 0 })
    expect(stats.currentTotal.usage.inputTokens).toBe(0)
  })
  test('step ends append and refresh currentTotal with latest root fields', () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    store.handleStepEnd(stepEnd(10, { 'x-first': '1' }))
    store.handleStepEnd(stepEnd(20, { 'x-second': '2' }))
    const stats = store.get()
    expect(stats.steps).toHaveLength(2)
    expect(stats.currentTotal.usage.inputTokens).toBe(30)
    expect(stats.currentTotal.cost.input).toBeCloseTo(30, 9)
    expect(stats.headers).toEqual({ 'x-second': '2' })
    expect(stats.performance?.stepTimeMs).toBe(20)
  })
  test('ends accumulate total usage and cost across generations', () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    store.handleStepEnd(stepEnd(10))
    store.handleEnd(end(10))
    store.handleStepEnd(stepEnd(20))
    store.handleEnd(end(20))
    const stats = store.get()
    expect(stats.steps).toHaveLength(2)
    expect(stats.total.usage.inputTokens).toBe(30)
    expect(stats.total.cost.input).toBeCloseTo(30, 9)
    expect(stats.finishReason).toBe('stop')
    expect(stats.rawFinishReason).toBe('stop')
  })
  test('listeners receive snapshots and unsubscribe stops delivery', () => {
    const store = createLoopStatsStore(() => undefined)
    const seen: LoopStats[] = []
    const unsubscribe = store.onChange((stats) => {
      seen.push(stats)
    })
    store.handleStepEnd(stepEnd(5))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.steps).toHaveLength(1)
    unsubscribe()
    store.handleStepEnd(stepEnd(5))
    expect(seen).toHaveLength(1)
  })
  test('snapshots isolate the steps array', () => {
    const store = createLoopStatsStore(() => undefined)
    store.handleStepEnd(stepEnd(5))
    const first = store.get()
    first.steps.push(first.steps[0] as (typeof first.steps)[number])
    expect(store.get().steps).toHaveLength(1)
  })
  test('restore seeds state so calculation continues across loads', () => {
    const first = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    first.handleStepEnd(stepEnd(10))
    first.handleEnd(end(10))
    const second = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    second.restore(first.get())
    second.handleStepEnd(stepEnd(20))
    second.handleEnd(end(20))
    const stats = second.get()
    expect(stats.steps).toHaveLength(2)
    expect(stats.total.usage.inputTokens).toBe(30)
    expect(stats.total.cost.input).toBeCloseTo(30, 9)
    expect(stats.currentTotal.usage.inputTokens).toBe(30)
  })
  test('snapshots isolate usage objects from later mutation', () => {
    const store = createLoopStatsStore(() => undefined)
    const input = stepEnd(5)
    store.handleStepEnd(input)
    input.usage.inputTokens = 999
    const snap = store.get()
    const step = snap.steps[0]
    if (step) step.usage.inputTokens = 888
    const fresh = store.get()
    expect(fresh.steps[0]?.usage.inputTokens).toBe(5)
    expect(fresh.currentTotal.usage.inputTokens).toBe(5)
  })
})
