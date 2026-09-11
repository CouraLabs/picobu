import { describe, expect, test } from 'bun:test'
import type { LanguageModelUsage } from 'ai'
import { addCosts, calcStepCost, emptyUsage, sumUsage, zeroCost } from '../../src/agent/loop/loop-cost.ts'

const usage = (overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage => ({
  ...emptyUsage(),
  ...overrides,
})

describe('zeroCost and emptyUsage', () => {
  test('zero cost has all zero fields', () => {
    expect(zeroCost()).toEqual({ input: 0, output: 0, cache: 0, total: 0 })
  })
  test('empty usage has zero tokens', () => {
    const got = emptyUsage()
    expect(got.inputTokens).toBe(0)
    expect(got.outputTokens).toBe(0)
    expect(got.totalTokens).toBe(0)
  })
})

describe('calcStepCost', () => {
  const billing = { input: 3, output: 6, cacheRead: 1, cacheWrite: 2 }
  test('splits input output and cache with per-million rates', () => {
    const got = calcStepCost(
      usage({
        inputTokens: 1_000_000,
        inputTokenDetails: { noCacheTokens: 500_000, cacheReadTokens: 300_000, cacheWriteTokens: 200_000 },
        outputTokens: 1_000_000,
      }),
      billing,
    )
    expect(got.input).toBeCloseTo(1.5, 9)
    expect(got.output).toBeCloseTo(6, 9)
    expect(got.cache).toBeCloseTo(0.7, 9)
    expect(got.total).toBeCloseTo(8.2, 9)
  })
  test('falls back to input minus cache when noCacheTokens is missing', () => {
    const got = calcStepCost(
      usage({
        inputTokens: 1_000,
        inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: 200, cacheWriteTokens: 100 },
        outputTokens: 0,
      }),
      billing,
    )
    expect(got.input).toBeCloseTo((700 / 1_000_000) * 3, 12)
  })
  test('missing billing yields zeros', () => {
    const got = calcStepCost(usage({ inputTokens: 100, outputTokens: 100 }))
    expect(got).toEqual({ input: 0, output: 0, cache: 0, total: 0 })
  })
  test('missing token counts default to zero', () => {
    const got = calcStepCost({} as LanguageModelUsage, billing)
    expect(got).toEqual({ input: 0, output: 0, cache: 0, total: 0 })
  })
})

describe('sumUsage and addCosts', () => {
  test('sumUsage adds every token bucket', () => {
    const got = sumUsage(
      usage({ inputTokens: 10, outputTokens: 4, totalTokens: 14, inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
      usage({ inputTokens: 5, outputTokens: 6, totalTokens: 11, inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 0 } }),
    )
    expect(got.inputTokens).toBe(15)
    expect(got.outputTokens).toBe(10)
    expect(got.totalTokens).toBe(25)
    expect(got.inputTokenDetails?.noCacheTokens).toBe(13)
    expect(got.inputTokenDetails?.cacheReadTokens).toBe(2)
  })
  test('addCosts adds every cost bucket', () => {
    expect(addCosts({ input: 1, output: 2, cache: 3, total: 6 }, { input: 0.5, output: 0.5, cache: 0, total: 1 })).toEqual({ input: 1.5, output: 2.5, cache: 3, total: 7 })
  })
})
