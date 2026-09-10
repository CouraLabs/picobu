import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointStore } from '../../src/agent/sessions/checkpoints.ts'
import { JobTracker } from '../../src/agent/sessions/session-jobs.ts'
import { SessionSaver } from '../../src/agent/sessions/session-store.ts'
import { initLockDir } from '../../src/shared/lock.ts'

describe('SessionSaver', () => {
  let dir = ''
  let filePath = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-saver-'))
    initLockDir(dir)
    filePath = join(dir, 'sess.jsonl')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  function message(id: string, text: string) {
    return { id, role: 'user' as const, parts: [{ type: 'text' as const, text }] }
  }
  test('survives a failed save and keeps writing', async () => {
    const saver = new SessionSaver(join(dir, 'missing-parent', 'deep', 's.jsonl'))
    await saver.save([message('1', 'hello')])
    await saver.save([message('1', 'hello'), message('2', 'world')])
    const content = await readFile(join(dir, 'missing-parent', 'deep', 's.jsonl'), 'utf8')
    expect(content).toContain('"id":"2"')
  })
  test('flush resolves after saves', async () => {
    const saver = new SessionSaver(filePath)
    await saver.save([message('1', 'hi')])
    await expect(saver.flush()).resolves.toBeUndefined()
  })
})

describe('CheckpointStore', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-ckpt-'))
    initLockDir(dir)
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('discards redo branch on both memory and disk', async () => {
    const path = join(dir, 'checkpoints.jsonl')
    const store = new CheckpointStore(path)
    await store.record({ tool: 'write', path: join(dir, 'a.txt'), before: null, after: '1' })
    await store.record({ tool: 'write', path: join(dir, 'a.txt'), before: '1', after: '2' })
    await store.undo()
    await store.record({ tool: 'write', path: join(dir, 'a.txt'), before: '1', after: '3' })
    expect(store.canRedo).toBe(false)
    const fresh = new CheckpointStore(path)
    await fresh.load()
    expect(fresh.canRedo).toBe(false)
    expect(fresh.canUndo).toBe(true)
  })
})

describe('JobTracker', () => {
  test('release without acquire never goes negative', () => {
    const tracker = new JobTracker()
    tracker.releaseSlot()
    tracker.releaseSlot()
    expect(tracker.activeSlots).toBe(0)
  })
  test('acquire and release round trip', async () => {
    const tracker = new JobTracker()
    await tracker.acquireSlot(2)
    expect(tracker.activeSlots).toBe(1)
    tracker.releaseSlot()
    expect(tracker.activeSlots).toBe(0)
  })
})
