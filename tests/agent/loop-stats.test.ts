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

const usageOf = (inputTokens: number, outputTokens = 0) => ({
  ...emptyUsage(),
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
  inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

const stepEnd = (inputTokens: number, headers?: Record<string, string>): StepEndInput => ({
  usage: usageOf(inputTokens),
  performance: performance(inputTokens),
  warnings: undefined,
  response: { headers },
  finishReason: 'stop',
})

const end = (inputTokens: number, outputTokens = 0): EndInput => ({
  usage: usageOf(inputTokens, outputTokens),
  finishReason: 'stop',
})

describe('createLoopStatsStore', () => {
  test('starts empty with zero totals', () => {
    const store = createLoopStatsStore(() => ({ input: 1, output: 1 }))
    const stats = store.get()
    expect(stats.usage).toBeUndefined()
    expect(stats.finishReason).toBeUndefined()
    expect(stats.tokenTotals).toBeUndefined()
    expect(stats.total.cost).toEqual({ input: 0, output: 0, cache: 0, total: 0 })
    expect(stats.total.usage.inputTokens).toBe(0)
  })
  test('step end replaces the last step and refreshes root fields', () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    store.handleStepEnd(stepEnd(10, { 'x-first': '1' }))
    store.handleStepEnd(stepEnd(20, { 'x-second': '2' }))
    const stats = store.get()
    expect(stats.usage?.inputTokens).toBe(20)
    expect(stats.headers).toEqual({ 'x-second': '2' })
    expect(stats.total.usage.inputTokens).toBe(20)
    expect(stats.total.cost.input).toBeCloseTo(30, 9)
    expect(stats.performance?.stepTimeMs).toBe(20)
  })
  test('step count accumulates across steps', () => {
    const store = createLoopStatsStore(() => undefined)
    store.handleStepEnd(stepEnd(10))
    store.handleStepEnd(stepEnd(20))
    expect(store.get().stepCount).toBe(2)
  })
  test('end sets token totals from the end usage while usage and cost stay step-based', () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    store.handleStepEnd(stepEnd(10))
    store.handleStepEnd(stepEnd(20, { 'x-second': '2' }))
    store.handleEnd(end(150, 7))
    const stats = store.get()
    expect(stats.tokenTotals).toEqual({ inputTokens: 150, outputTokens: 7 })
    expect(stats.total.usage.inputTokens).toBe(20)
    expect(stats.total.cost.input).toBeCloseTo(30, 9)
    expect(stats.finishReason).toBe('stop')
    expect(stats.headers).toEqual({ 'x-second': '2' })
  })
  test('token totals stay undefined until the loop ends', () => {
    const store = createLoopStatsStore(() => undefined)
    store.handleStepEnd(stepEnd(10))
    expect(store.get().tokenTotals).toBeUndefined()
    store.handleEnd(end(10))
    expect(store.get().tokenTotals).toEqual({ inputTokens: 10, outputTokens: 0 })
  })
  test('listeners receive snapshots and unsubscribe stops delivery', () => {
    const store = createLoopStatsStore(() => undefined)
    const seen: LoopStats[] = []
    const unsubscribe = store.onChange((stats) => {
      seen.push(stats)
    })
    store.handleStepEnd(stepEnd(5))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.usage).toBeDefined()
    unsubscribe()
    store.handleStepEnd(stepEnd(5))
    expect(seen).toHaveLength(1)
  })
  test('snapshots isolate the last step', () => {
    const store = createLoopStatsStore(() => undefined)
    store.handleStepEnd(stepEnd(5))
    const first = store.get()
    if (first.usage) first.usage.inputTokens = 999
    expect(store.get().usage?.inputTokens).toBe(5)
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
    expect(stats.stepCount).toBe(2)
    expect(stats.usage?.inputTokens).toBe(20)
    expect(stats.total.usage.inputTokens).toBe(20)
    expect(stats.total.cost.input).toBeCloseTo(30, 9)
  })
  test('snapshots isolate usage objects from later mutation', () => {
    const store = createLoopStatsStore(() => undefined)
    const input = stepEnd(5)
    store.handleStepEnd(input)
    input.usage.inputTokens = 999
    const snap = store.get()
    if (snap.usage) snap.usage.inputTokens = 888
    const fresh = store.get()
    expect(fresh.usage?.inputTokens).toBe(5)
    expect(fresh.total.usage.inputTokens).toBe(5)
  })
  test('restore falls back to one step for the count when stepCount is absent', () => {
    const store = createLoopStatsStore(() => undefined)
    const restored: LoopStats = {
      ...store.get(),
      stepCount: undefined,
      usage: stepEnd(1).usage,
      performance: performance(1),
      headers: undefined,
      finishReason: 'stop',
    }
    store.restore(restored)
    expect(store.get().stepCount).toBe(1)
  })
  test('restore carries token totals', () => {
    const first = createLoopStatsStore(() => undefined)
    first.handleStepEnd(stepEnd(10))
    first.handleEnd(end(30, 4))
    const second = createLoopStatsStore(() => undefined)
    second.restore(first.get())
    expect(second.get().tokenTotals).toEqual({ inputTokens: 30, outputTokens: 4 })
  })
  test('keeps usage raw payloads for step-raw status items', () => {
    const store = createLoopStatsStore(() => undefined)
    const input = stepEnd(5)
    input.usage.raw = { cost: { hypercredits: 11 } }
    store.handleStepEnd(input)
    const stats = store.get()
    expect((stats.usage?.raw as { cost?: { hypercredits?: number } })?.cost?.hypercredits).toBe(11)
  })
  test('addExternal adds cost without touching usage and keeps accumulating', () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 0 }))
    store.handleStepEnd(stepEnd(10))
    const before = store.get().total.usage
    store.addExternal({ input: 0.5, output: 0.25, cache: 0.25, total: 1 })
    const stats = store.get()
    expect(stats.total.usage).toEqual(before)
    expect(stats.total.cost).toEqual({ input: 10.5, output: 0.25, cache: 0.25, total: 11 })
    store.handleStepEnd(stepEnd(20))
    expect(store.get().total.cost.input).toBeCloseTo(30.5, 9)
  })
  test('addExternal notifies listeners', () => {
    const store = createLoopStatsStore(() => undefined)
    const seen: LoopStats[] = []
    const unsubscribe = store.onChange((stats) => {
      seen.push(stats)
    })
    store.addExternal({ input: 1, output: 1, cache: 0, total: 2 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.total.cost.total).toBe(2)
    unsubscribe()
  })
  test('endpoint values merge and notify listeners', () => {
    const store = createLoopStatsStore(() => undefined)
    const seen: Array<LoopStats> = []
    const unsubscribe = store.onChange((stats) => {
      seen.push(stats)
    })
    store.setEndpointValues({ HyperCredits: { balance: 100 } })
    store.setEndpointValues({ Other: 1 })
    const stats = store.get()
    expect(stats.endpoints).toEqual({ HyperCredits: { balance: 100 }, Other: 1 })
    expect(seen).toHaveLength(2)
    unsubscribe()
  })
  test('restore carries endpoint values', () => {
    const first = createLoopStatsStore(() => undefined)
    first.setEndpointValues({ HyperCredits: { balance: 50 } })
    const second = createLoopStatsStore(() => undefined)
    second.restore(first.get())
    expect(second.get().endpoints).toEqual({ HyperCredits: { balance: 50 } })
  })
})
