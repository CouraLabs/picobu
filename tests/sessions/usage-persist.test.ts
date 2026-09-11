import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addToTotals, emptyTotals, liveTotals, readSessionMeta, writeSessionMeta } from '../../src/agent/sessions/session-meta.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir

const billingCost = { inputCost: 2.1, outputCost: 3, cacheReadCost: 0.1, cacheWriteCost: 0.4, cacheCost: 0.5, total: 5.6 }

describe('usage persistence', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-usage-'))
    options.app.systemDir = dir
    initLockDir(dir)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('computed accumulators and cost survive meta round trip', async () => {
    let totals = emptyTotals()
    totals = addToTotals(totals, {
      source: 'run',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 100,
      cacheWriteTokens: 200,
      reasoningTokens: 50,
      textTokens: 450,
      totalTokens: 1500,
      noCacheInputTokens: 700,
      cost: billingCost,
    })
    totals = addToTotals(totals, {
      source: 'run',
      inputTokens: 500,
      outputTokens: 50,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
      totalTokens: 550,
      noCacheInputTokens: 100,
      cost: { inputCost: 0.0003, outputCost: 0.0003, cacheReadCost: 0.0004, cacheWriteCost: 0, cacheCost: 0.0004, total: 0.001 },
    })
    expect(totals.totalTokens).toBe(2050)
    expect(totals.computed.accNoCacheInputTokens).toBe(800)
    expect(totals.computed.accOutputTokens).toBe(550)
    expect(totals.computed.cost?.total).toBeCloseTo(5.601, 10)
    await writeSessionMeta('fk', 'usage1', { id: 'usage1', state: 'finished', cwd: '/tmp', createdAt: 1, updatedAt: 1, totals })
    const meta = await readSessionMeta('fk', 'usage1')
    expect(meta?.totals?.computed.accNoCacheInputTokens).toBe(800)
    expect(meta?.totals?.totalTokens).toBe(2050)
    expect(meta?.totals?.costDetails.total).toBeCloseTo(5.601, 10)
    expect(meta?.totals?.costDetails.cacheReadCost).toBeCloseTo(0.1004, 10)
    expect(meta?.totals?.costDetails.details).toHaveLength(2)
  })
  test('live totals merge without appending details', () => {
    const base = addToTotals(emptyTotals(), {
      source: 'run',
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      noCacheInputTokens: 100,
    })
    const live = liveTotals(base, { source: 'run', inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, noCacheInputTokens: 50 })
    expect(live.inputTokens).toBe(150)
    expect(live.totalTokens).toBe(165)
    expect(live.costDetails.details).toHaveLength(1)
  })
})
