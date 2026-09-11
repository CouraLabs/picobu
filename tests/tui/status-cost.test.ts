import { describe, expect, test } from 'bun:test'
import { addToTotals, emptyTotals } from '../../src/agent/sessions/session-meta.ts'
import { getCostSplit, getCostValue, getResponseTimeLabel, getStepTimeLabel, getToolExecLabel, getTpsLabel, getTtftLabel } from '../../src/tui/components/session/status/session-status-data.ts'

const cost = { inputCost: 2.1, outputCost: 3, cacheReadCost: 0.1, cacheWriteCost: 0.4, cacheCost: 0.5, total: 5.6 }

const performance = {
  effectiveOutputTokensPerSecond: 40,
  outputTokensPerSecond: 45,
  inputTokensPerSecond: 500,
  effectiveTotalTokensPerSecond: 120,
  stepTimeMs: 1500,
  responseTimeMs: 1200,
  toolExecutionMs: { 'call-1': 300, 'call-2': 200 },
  timeToFirstOutputMs: 250,
}

describe('status cost display', () => {
  test('prefers session computed total over message cost', () => {
    const totals = addToTotals(emptyTotals(), {
      source: 'run',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheWriteTokens: 200,
      noCacheInputTokens: 700,
      cost,
    })
    expect(getCostValue(totals, { inputTokens: 1, outputTokens: 1, cost: 0.01 }, undefined)).toBe('5.60')
  })
  test('falls back to latest message cost before first commit', () => {
    expect(getCostValue(emptyTotals(), { inputTokens: 100, outputTokens: 10, cost: 0.01 }, undefined)).toBe('0.01')
    expect(getCostValue(undefined, undefined, undefined)).toBe('–')
  })
  test('split renders four-way breakdown', () => {
    const totals = addToTotals(emptyTotals(), {
      source: 'run',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheWriteTokens: 200,
      noCacheInputTokens: 700,
      cost,
    })
    const split = getCostSplit(totals)
    expect(split).toContain('in $')
    expect(split).toContain('out $')
    expect(split).toContain('read $')
    expect(split).toContain('write $')
  })
  test('split falls back to live message computed cost', () => {
    const split = getCostSplit(emptyTotals(), {
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      computed: { accNoCacheInputTokens: 700_000, accOutputTokens: 10, accCacheReadTokens: 0, accCacheWriteTokens: 0, accReasoningTokens: 0, accTextTokens: 0, cost },
    })
    expect(split).toContain('in $')
  })
  test('split hides when no cost is known', () => {
    expect(getCostSplit(emptyTotals())).toBeUndefined()
    expect(getCostSplit(undefined)).toBeUndefined()
  })
})

describe('status performance display', () => {
  test('tps and ttft come from SDK performance', () => {
    const usage = { inputTokens: 100, outputTokens: 10, performance }
    expect(getTpsLabel(usage, undefined)).toBe('45t/s')
    expect(getTtftLabel(usage, undefined)).toBe('250ms')
  })
  test('tps and ttft fall back to message metadata performance', () => {
    expect(getTpsLabel(undefined, { usage: { inputTokens: 100, outputTokens: 10, performance } })).toBe('45t/s')
    expect(getTtftLabel(undefined, { usage: { inputTokens: 100, outputTokens: 10, performance } })).toBe('250ms')
  })
  test('tps and ttft show placeholder without performance', () => {
    expect(getTpsLabel(undefined, undefined)).toBe('–')
    expect(getTtftLabel(undefined, undefined)).toBe('–')
    expect(getTpsLabel({ inputTokens: 100, outputTokens: 10 }, undefined)).toBe('–')
  })
  test('step response and tool times come from latest performance', () => {
    const latest = { inputTokens: 100, outputTokens: 10, performance }
    expect(getStepTimeLabel(latest)).toBe('1.5s')
    expect(getResponseTimeLabel(latest)).toBe('1.2s')
    expect(getToolExecLabel(latest)).toBe('500ms')
  })
  test('timing labels show placeholder without performance', () => {
    expect(getStepTimeLabel(undefined)).toBe('–')
    expect(getResponseTimeLabel(undefined)).toBe('–')
    expect(getToolExecLabel(undefined)).toBe('–')
    expect(getToolExecLabel({ inputTokens: 100, outputTokens: 10 })).toBe('–')
  })
})
