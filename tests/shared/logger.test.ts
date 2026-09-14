import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildLogFileName, closeLogger, flushLogger, formatDateForFilename, getLogPath, initLogger, logError, sanitizeRunId, setLogRunId } from '../../src/shared/logger.ts'

let dir = ''

beforeEach(() => {
  closeLogger()
  dir = mkdtempSync(join(tmpdir(), 'picobu-logger-'))
})

afterEach(() => {
  closeLogger()
  rmSync(dir, { recursive: true, force: true })
})

describe('logger filename', () => {
  test('sanitize strips traversal', () => {
    expect(sanitizeRunId('../../etc/passwd')).toBe('..-..-etc-passwd')
    expect(sanitizeRunId('../../etc/passwd')).not.toContain('/')
    expect(sanitizeRunId('')).toBe(`pid-${process.pid}`)
    expect(sanitizeRunId('abc123')).toBe('abc123')
  })
  test('filename uses log-<run>-<date>.log shape', () => {
    const name = buildLogFileName('abc123', new Date('2026-09-12T10:30:00.000Z'))
    expect(name).toBe('log-abc123-2026-09-12T10-30-00.log')
  })
  test('date has no colons', () => {
    expect(formatDateForFilename(new Date('2026-01-02T03:04:05.000Z'))).not.toContain(':')
  })
})

describe('logger file output', () => {
  const readLogBody = async (path: string, needle: string): Promise<string> => {
    const deadline = Date.now() + 2000
    for (;;) {
      flushLogger()
      const body = readFileSync(path, 'utf8')
      if (body.includes(needle) || Date.now() > deadline) return body
      await Bun.sleep(10)
    }
  }
  test('init creates session-scoped log file', async () => {
    const path = initLogger({ runId: 'sess123', systemDir: dir })
    expect(path.startsWith(dir)).toBe(true)
    expect(basename(path).startsWith('log-sess123-')).toBe(true)
    expect(getLogPath()).toBe(path)
    const body = await readLogBody(path, 'logger started')
    expect(body).toContain('logger started')
  })
  test('falls back to pid run id', () => {
    const path = initLogger({ systemDir: dir })
    expect(basename(path).startsWith(`log-pid-${process.pid}-`)).toBe(true)
  })
  test('logError writes serialized error to file', async () => {
    const path = initLogger({ runId: 'sess123', systemDir: dir })
    logError(new Error('boom-failure'), { scope: 'test' })
    const body = await readLogBody(path, 'boom-failure')
    expect(body).toContain('boom-failure')
    expect(body).toContain('test')
  })
  test('logError keeps provider status and body for api errors', async () => {
    const path = initLogger({ runId: 'sess123', systemDir: dir })
    const failure = new Error('AI_RetryError · Failed after 3 attempts') as Error & { lastError?: unknown }
    const cause = new Error('Internal server error') as Error & { statusCode?: unknown; url?: unknown; responseBody?: unknown }
    cause.statusCode = 500
    cause.url = 'https://opencode.ai/zen/go/v1/chat/completions'
    cause.responseBody = '{"type":"error"}'
    failure.lastError = cause
    logError(failure, { scope: 'test' })
    const body = await readLogBody(path, 'AI_RetryError')
    expect(body).toContain('500')
    expect(body).toContain('opencode.ai')
  })
  test('setLogRunId switches to session file', () => {
    const first = initLogger({ systemDir: dir })
    const second = setLogRunId('newsession', dir)
    expect(second).not.toBe(first)
    expect(basename(second).startsWith('log-newsession-')).toBe(true)
    expect(getLogPath()).toBe(second)
  })
  test('setLogRunId adopts pid log and removes the orphan', async () => {
    const first = initLogger({ systemDir: dir })
    logError(new Error('bootstrap-boom'), { scope: 'bootstrap' })
    await readLogBody(first, 'bootstrap-boom')
    const second = setLogRunId('adopted-session', dir)
    expect(second).not.toBe(first)
    expect(existsSync(first)).toBe(false)
    const body = await readLogBody(second, 'bootstrap-boom')
    expect(body).toContain('bootstrap-boom')
  })
  test('retention keeps newest 20 files', () => {
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(dir, `log-old-${i}-2026-01-01T00-00-00.log`), 'x')
    }
    initLogger({ runId: 'sess123', systemDir: dir })
    const names = readdirSync(dir).filter((n) => n.startsWith('log-'))
    expect(names.length).toBeLessThanOrEqual(20)
    expect(names.some((n) => n.startsWith('log-sess123-'))).toBe(true)
  })
})
