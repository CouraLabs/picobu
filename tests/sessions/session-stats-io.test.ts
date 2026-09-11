import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyUsage } from '../../src/agent/loop/loop-cost.ts'
import { createLoopStatsStore } from '../../src/agent/loop/loop-stats.ts'
import { isLoopStats, readLoopStats, sessionStatsPath, writeLoopStats } from '../../src/agent/sessions/session-stats-io.ts'
import { options } from '../../src/config/options.ts'
import { initLockDir } from '../../src/shared/lock.ts'

const originalSystemDir = options.app.systemDir

describe('session stats io', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-stats-'))
    options.app.systemDir = dir
    initLockDir(dir)
  })
  afterEach(async () => {
    options.app.systemDir = originalSystemDir
    initLockDir(originalSystemDir)
    await rm(dir, { recursive: true, force: true })
  })
  test('missing file reads as undefined', async () => {
    expect(await readLoopStats('folder', 'absent')).toBeUndefined()
  })
  test('write then read round trip preserves totals', async () => {
    const store = createLoopStatsStore(() => ({ input: 1_000_000, output: 2_000_000 }))
    store.handleStepEnd({ usage: { ...emptyUsage(), inputTokens: 10, totalTokens: 10 }, performance: {} as never, warnings: undefined, response: {}, finishReason: 'stop', rawFinishReason: 'stop' })
    store.handleEnd({ usage: { ...emptyUsage(), inputTokens: 10, totalTokens: 10 }, finishReason: 'stop', rawFinishReason: 'stop' })
    await writeLoopStats('folder', 's1', store.get())
    const loaded = await readLoopStats('folder', 's1')
    expect(loaded?.steps).toHaveLength(1)
    expect(loaded?.total.usage.inputTokens).toBe(10)
    expect(loaded?.finishReason).toBe('stop')
    const resumed = createLoopStatsStore(() => ({ input: 1_000_000, output: 2_000_000 }))
    if (loaded) resumed.restore(loaded)
    resumed.handleEnd({ usage: { ...emptyUsage(), inputTokens: 5, totalTokens: 5 }, finishReason: 'stop', rawFinishReason: 'stop' })
    expect(resumed.get().total.usage.inputTokens).toBe(15)
  })
  test('corrupt file reads as undefined', async () => {
    const path = sessionStatsPath('folder', 'broken')
    await writeLoopStats('folder', 'ok', createLoopStatsStore(() => undefined).get())
    await writeFile(path, 'not json\n')
    expect(await readLoopStats('folder', 'broken')).toBeUndefined()
    expect(isLoopStats({ steps: [], total: { usage: {}, cost: { input: 0 } } })).toBe(false)
    expect(isLoopStats(undefined)).toBe(false)
  })
})
