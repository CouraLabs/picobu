import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeLogger, flushLogger, initLogger, logDebug } from '../../src/shared/logger.ts'

const dirs: Array<string> = []

afterEach(() => {
  closeLogger()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const readLogBody = async (path: string, needle: string): Promise<string> => {
  const deadline = Date.now() + 2000
  for (;;) {
    flushLogger()
    const body = (() => {
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return ''
      }
    })()
    if (body.includes(needle) || Date.now() > deadline) return body
    await Bun.sleep(20)
  }
}

describe('logDebug', () => {
  test('writes a debug line with context to the active log file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'picobu-logdebug-'))
    dirs.push(dir)
    const path = initLogger({ systemDir: dir, runId: 'logdebug-test' })
    logDebug('hello debug', { k: 1 })
    const body = await readLogBody(path, 'hello debug')
    expect(body).toContain('hello debug')
    expect(body).toContain('"level":20')
  })
})
