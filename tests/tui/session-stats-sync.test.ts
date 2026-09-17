import { describe, expect, test } from 'bun:test'
import type { LanguageModelUsage } from 'ai'
import type { LoopStats } from '../../src/agent/loop/create-loop.ts'
import { shouldSyncStats, toStatsState } from '../../src/tui/pages/session-stats-sync.ts'

const usage = (overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage => ({ inputTokens: 10, outputTokens: 5, totalTokens: 15, ...overrides }) as LanguageModelUsage

const statsWith = (overrides: Partial<LoopStats> = {}): LoopStats =>
  ({
    performance: undefined,
    warnings: undefined,
    headers: undefined,
    finishReason: undefined,
    usage: undefined,
    endpoints: undefined,
    total: { usage: usage(), cost: { input: 0, output: 0, cache: 0, total: 0 } },
    ...overrides,
  }) as LoopStats

describe('shouldSyncStats', () => {
  test('syncs when the live session matches the owner', () => {
    expect(shouldSyncStats('a', 'a', 'a')).toBe(true)
  })

  test('syncs when the owner is active but a different session is live', () => {
    expect(shouldSyncStats('a', 'b', 'a')).toBe(true)
  })

  test('blocks when the owner is neither live nor active', () => {
    expect(shouldSyncStats('a', 'b', 'c')).toBe(false)
  })

  test('syncs background updates without an owner', () => {
    expect(shouldSyncStats(undefined, 'b', 'c')).toBe(true)
  })
})

describe('toStatsState', () => {
  test('returns all-undefined state for undefined stats', () => {
    expect(toStatsState(undefined)).toEqual({ status: undefined, performance: undefined, metrics: undefined })
  })

  test('builds status, performance and metrics from stats', () => {
    const performance = { timeToFirstOutputMs: 120, outputTokensPerSecond: 42 } as NonNullable<LoopStats['performance']>
    const warnings = [{ message: 'slow' }] as LoopStats['warnings']
    const headers = { 'x-request-id': 'r1' }
    const endpoints = { rpm: 60 }
    const raw = { someProviderField: 1 }
    const stats = statsWith({
      performance: performance,
      warnings: warnings,
      headers: headers,
      endpoints: endpoints,
      finishReason: 'stop',
      stepCount: 2,
      usage: usage({ raw: raw }),
      total: { usage: usage(), cost: { input: 0.1, output: 0.2, cache: 0, total: 0.3 } },
    })
    const state = toStatsState(stats)
    expect(state.status).toEqual({ finishReason: 'stop', warnings: warnings, headers: headers, endpoints: endpoints, rawUsage: raw })
    expect(state.performance).toBe(performance)
    expect(state.metrics).toEqual({ total: stats.total, stepCount: 2 })
  })

  test('falls back to zero when stepCount is missing', () => {
    const stats = statsWith({
      usage: usage(),
      performance: { timeToFirstOutputMs: 0, outputTokensPerSecond: 0 } as NonNullable<LoopStats['performance']>,
    })
    expect(toStatsState(stats).metrics?.stepCount).toBe(0)
  })

  test('omits rawUsage when there is no last step', () => {
    const state = toStatsState(statsWith({ stepCount: 3 }))
    expect(state.status?.rawUsage).toBeUndefined()
    expect(state.metrics?.stepCount).toBe(3)
  })
})
