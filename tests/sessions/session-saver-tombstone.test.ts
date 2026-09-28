import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSession, SessionSaver } from '../../src/agent/sessions/session-store.ts'

let dir = ''
let filePath = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'picobu-saver-'))
  filePath = join(dir, 'session.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const message = (id: string, text: string): { id: string; role: 'user'; parts: Array<{ type: 'text'; text: string }> } => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
})

describe('SessionSaver tombstones', () => {
  test('a message removed while its save is queued still gets a tombstone', async () => {
    const saver = new SessionSaver(filePath)
    const msg = message('m1', 'hello')
    void saver.save([msg])
    void saver.save([])
    await saver.flush()
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('"tombstone":true')
    expect(content).toContain('m1')
    const loaded = await loadSession('test-folder', 'session')
    expect(loaded).toBeNull()
  })

  test('reverting then re-adding a changed message upserts', async () => {
    const saver = new SessionSaver(filePath)
    await saver.save([message('m1', 'v1')])
    await saver.save([])
    await saver.save([message('m1', 'v2')])
    await saver.flush()
    const content = await readFile(filePath, 'utf8')
    expect(content).toContain('v2')
    expect(content).not.toContain('v1')
  })
})
