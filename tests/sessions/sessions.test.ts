import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
  test('re-saving unchanged messages does not rewrite the file', async () => {
    const saver = new SessionSaver(filePath)
    await saver.save([message('1', 'hello'), message('2', 'world')])
    const first = await readFile(filePath, 'utf8')
    await saver.save([message('1', 'hello'), message('2', 'world')])
    const second = await readFile(filePath, 'utf8')
    expect(second).toBe(first)
  })
  test('changed messages are rewritten in place', async () => {
    const saver = new SessionSaver(filePath)
    await saver.save([message('1', 'hello'), message('2', 'world')])
    await saver.save([message('1', 'hello'), message('2', 'changed')])
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('"text":"changed"')
    expect(content).not.toContain('"text":"world"')
  })
  test('does not retain serialized messages in memory', async () => {
    const saver = new SessionSaver(join(dir, 'mem.jsonl'))
    for (let i = 1; i <= 25; i++) {
      await saver.save([message(`${i}`, 'm'.repeat(1_000_000))])
    }
    expect(saver.dedupeCacheBytes()).toBeLessThan(5_000)
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
  test('undo targets the latest record even when seqs collide across stores', async () => {
    const path = join(dir, 'shared.jsonl')
    const target = join(dir, 'a.txt')
    const writeStore = new CheckpointStore(path)
    await writeStore.record({ tool: 'write', path: target, before: null, after: 'one' })
    const patchStore = new CheckpointStore(path)
    await patchStore.record({ tool: 'write', path: target, before: 'one', after: 'two' })
    await writeStore.record({ tool: 'write', path: target, before: 'two', after: 'three' })
    const transient = new CheckpointStore(path)
    await transient.undo()
    expect(await readFile(target, 'utf8')).toBe('two')
    await transient.undo()
    expect(await readFile(target, 'utf8')).toBe('one')
    await transient.undo()
    expect(
      await stat(target).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
    await transient.redo()
    expect(await readFile(target, 'utf8')).toBe('one')
  })
  test('does not retain file contents in memory', async () => {
    const storePath = join(dir, 'mem.jsonl')
    const target = join(dir, 'target.txt')
    const store = new CheckpointStore(storePath)
    await store.record({ tool: 'write', path: target, before: null, after: '' })
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) {
        Bun.gc(true)
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
      Bun.gc(true)
    }
    await settle()
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < 20; i++) {
      await store.record({ tool: 'write', path: target, before: 'a'.repeat(1_000_000), after: 'b'.repeat(1_000_000) })
    }
    await settle()
    const after = process.memoryUsage().heapUsed
    expect(after - before).toBeLessThan(15_000_000)
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
