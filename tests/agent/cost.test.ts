import { describe, expect, test } from 'bun:test'
import type { StepResultPerformance } from 'ai'
import { computeCost, computeUsageCost, deriveNoCacheInputTokens, nextUsage, projectedContext, toLoopPerformance } from '../../src/agent/model/cost.ts'

const billing = { input: 3, output: 6, cacheRead: 1, cacheWrite: 2 }

describe('deriveNoCacheInputTokens', () => {
  test('subtracts cache from input and clamps', () => {
    expect(deriveNoCacheInputTokens(1000, 100, 200)).toBe(700)
    expect(deriveNoCacheInputTokens(10, 8, 5)).toBe(0)
    expect(deriveNoCacheInputTokens(undefined, undefined, undefined)).toBe(0)
  })
})

describe('nextUsage', () => {
  test('top level holds last step while computed accumulates', () => {
    const first = nextUsage(undefined, { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 200, reasoningTokens: 10, textTokens: 90 }, billing)
    const second = nextUsage(first, { inputTokens: 500, outputTokens: 50, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 5, textTokens: 45 }, billing)
    expect(second.inputTokens).toBe(500)
    expect(second.outputTokens).toBe(50)
    expect(second.totalTokens).toBe(550)
    expect(second.computed?.accNoCacheInputTokens).toBe(700 + 100)
    expect(second.computed?.accOutputTokens).toBe(150)
    expect(second.computed?.accCacheReadTokens).toBe(500)
    expect(second.computed?.accCacheWriteTokens).toBe(200)
    expect(second.computed?.accReasoningTokens).toBe(15)
    expect(second.computed?.accTextTokens).toBe(135)
  })
  test('totalTokens is never accumulated', () => {
    const first = nextUsage(undefined, { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }, billing)
    const second = nextUsage(first, { inputTokens: 200, outputTokens: 20, totalTokens: 220 }, billing)
    expect(second.totalTokens).toBe(220)
    expect(projectedContext(second)).toBe(220)
  })
  test('cost is computed from accumulators', () => {
    const usage = nextUsage(
      nextUsage(undefined, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 200 }, billing),
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100, cacheWriteTokens: 200 },
      billing,
    )
    expect(usage.computed?.cost?.inputCost).toBeCloseTo(0.0042, 10)
    expect(usage.computed?.cost?.cacheCost).toBeCloseTo(0.001, 10)
    expect(usage.computed?.cost?.total).toBeCloseTo(0.0112, 10)
    expect(computeCost(usage, billing)).toBeCloseTo(0.0112, 10)
  })
  test('missing billing still accumulates tokens with undefined cost', () => {
    const usage = nextUsage(nextUsage(undefined, { inputTokens: 100, outputTokens: 10 }, undefined), { inputTokens: 50, outputTokens: 5 }, undefined)
    expect(usage.computed?.accOutputTokens).toBe(15)
    expect(usage.computed?.cost).toBeUndefined()
    expect(computeCost(usage, undefined)).toBeUndefined()
  })
  test('computeUsageCost returns undefined without billing', () => {
    expect(computeUsageCost({ noCacheInputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 })).toBeUndefined()
  })
})

const streamingPerformance = (): StepResultPerformance => ({
  effectiveOutputTokensPerSecond: 40,
  outputTokensPerSecond: 45,
  inputTokensPerSecond: 500,
  effectiveTotalTokensPerSecond: 120,
  stepTimeMs: 1500,
  responseTimeMs: 1200,
  toolExecutionMs: { 'call-1': 300 },
  timeToFirstOutputMs: 200,
  timeBetweenOutputChunksMs: { min: 5, p10: 8, median: 20, avg: 22, p90: 40, max: 60 },
})

describe('toLoopPerformance', () => {
  test('maps every field and detaches mutable copies', () => {
    const source = streamingPerformance()
    const mapped = toLoopPerformance(source)
    expect(mapped.effectiveOutputTokensPerSecond).toBe(40)
    expect(mapped.outputTokensPerSecond).toBe(45)
    expect(mapped.inputTokensPerSecond).toBe(500)
    expect(mapped.effectiveTotalTokensPerSecond).toBe(120)
    expect(mapped.stepTimeMs).toBe(1500)
    expect(mapped.responseTimeMs).toBe(1200)
    expect(mapped.timeToFirstOutputMs).toBe(200)
    expect(mapped.toolExecutionMs).toEqual({ 'call-1': 300 })
    expect(mapped.toolExecutionMs).not.toBe(source.toolExecutionMs)
    expect(mapped.timeBetweenOutputChunksMs).toEqual({ min: 5, p10: 8, median: 20, avg: 22, p90: 40, max: 60 })
  })
  test('omits streaming-only fields when the step did not stream', () => {
    const mapped = toLoopPerformance({
      effectiveOutputTokensPerSecond: 40,
      outputTokensPerSecond: undefined,
      inputTokensPerSecond: undefined,
      effectiveTotalTokensPerSecond: 120,
      stepTimeMs: 1500,
      responseTimeMs: 1200,
      toolExecutionMs: {},
      timeToFirstOutputMs: undefined,
    })
    expect(mapped.outputTokensPerSecond).toBeUndefined()
    expect(mapped.inputTokensPerSecond).toBeUndefined()
    expect(mapped.timeToFirstOutputMs).toBeUndefined()
    expect(mapped.timeBetweenOutputChunksMs).toBeUndefined()
    expect(mapped.stepTimeMs).toBe(1500)
  })
})

describe('nextUsage performance', () => {
  test('performance is replaced by the latest step, never accumulated', () => {
    const first = nextUsage(undefined, { inputTokens: 1000, outputTokens: 100, performance: toLoopPerformance(streamingPerformance()) }, billing)
    const secondPerformance = { ...streamingPerformance(), stepTimeMs: 800, responseTimeMs: 700 }
    const second = nextUsage(first, { inputTokens: 500, outputTokens: 50, performance: toLoopPerformance(secondPerformance) }, billing)
    expect(second.performance?.stepTimeMs).toBe(800)
    expect(second.performance?.responseTimeMs).toBe(700)
    expect(second.computed?.accOutputTokens).toBe(150)
  })
  test('steps without performance leave it absent', () => {
    const withPerf = nextUsage(undefined, { inputTokens: 1000, outputTokens: 100, performance: toLoopPerformance(streamingPerformance()) }, billing)
    expect(withPerf.performance?.stepTimeMs).toBe(1500)
    const withoutPerf = nextUsage(withPerf, { inputTokens: 500, outputTokens: 50 }, billing)
    expect(withoutPerf.performance).toBeUndefined()
    expect(nextUsage(undefined, { inputTokens: 100, outputTokens: 10 }, billing).performance).toBeUndefined()
  })
})
