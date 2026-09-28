import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastSessionLaunchPlan, lastSessionPath, readLastSession, sessionExists, writeLastSession } from '../../src/agent/sessions/last-session.ts'

const makeDir = (): string => mkdtempSync(join(tmpdir(), 'picobu-last-session-'))

describe('last-session', () => {
  test('round-trips a written entry', () => {
    const dir = makeDir()
    const entry = { sessionId: 'abc123', cwd: '/tmp/work', at: 42 }
    writeLastSession(entry, dir)
    expect(readLastSession(dir)).toEqual(entry)
  })

  test('reads undefined when the file is missing', () => {
    expect(readLastSession(makeDir())).toBeUndefined()
  })

  test('reads undefined for corrupt or incomplete json', () => {
    const dir = makeDir()
    writeFileSync(lastSessionPath(dir), 'not json')
    expect(readLastSession(dir)).toBeUndefined()
    writeFileSync(lastSessionPath(dir), JSON.stringify({ cwd: '/tmp/work' }))
    expect(readLastSession(dir)).toBeUndefined()
  })

  test('sessionExists reflects <dir>/sessions/<folderKey>/<id>.meta.json', () => {
    const dir = makeDir()
    const entry = { sessionId: 's1', cwd: '/tmp/MyProject', at: 0 }
    expect(sessionExists(entry, dir)).toBe(false)
    const sessionDir = join(dir, 'sessions', 'myproject')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 's1.meta.json'), '{}')
    expect(sessionExists(entry, dir)).toBe(true)
  })

  test('launch plan is empty when the session is missing', () => {
    const dir = makeDir()
    writeLastSession({ sessionId: 'gone', cwd: '/tmp/work', at: 0 }, dir)
    expect(lastSessionLaunchPlan(dir)).toEqual({})
  })

  test('launch plan returns id and cwd when the session exists', () => {
    const dir = makeDir()
    const entry = { sessionId: 's2', cwd: '/tmp/WorkDir', at: 7 }
    writeLastSession(entry, dir)
    const sessionDir = join(dir, 'sessions', 'workdir')
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 's2.jsonl'), '')
    expect(lastSessionLaunchPlan(dir)).toEqual({ sessionId: 's2', cwd: '/tmp/WorkDir' })
  })
})
