import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeLogger, flushLogger, initLogger } from '../../src/shared/logger.ts'
import { divertStderr } from '../../src/shared/quiet-stderr.ts'

let dir = ''
let restore: (() => void) | undefined

beforeEach(() => {
  closeLogger()
  dir = mkdtempSync(join(tmpdir(), 'picobu-quiet-stderr-'))
})

afterEach(() => {
  restore?.()
  restore = undefined
  process.stderr.write = realStderrWrite
  closeLogger()
  rmSync(dir, { recursive: true, force: true })
})

const realStderrWrite = process.stderr.write.bind(process.stderr)

const readLogBody = async (path: string, needle: string): Promise<string> => {
  const deadline = Date.now() + 2000
  for (;;) {
    flushLogger()
    const body = readFileSync(path, 'utf8')
    if (body.includes(needle) || Date.now() > deadline) return body
    await Bun.sleep(10)
  }
}

describe('divertStderr', () => {
  test('routes raw stderr writes to the logger and restores passthrough', async () => {
    const path = initLogger({ runId: 'quiet-stderr-test', systemDir: dir })
    const passthrough: Array<string> = []
    process.stderr.write = ((chunk: Uint8Array | string) => {
      passthrough.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    restore = divertStderr(false)
    process.stderr.write('node:58731) something broke\nsecond ')
    process.stderr.write('line\n')
    expect(passthrough).toEqual([])
    const body = await readLogBody(path, 'second line')
    expect(body).toContain('node:58731) something broke')
    expect(body).toContain('second line')
    expect(body).toContain('"scope":"stderr"')
  })
  test('buffers partial lines and drops blank ones', async () => {
    const path = initLogger({ runId: 'quiet-stderr-blank', systemDir: dir })
    const passthrough: Array<string> = []
    process.stderr.write = ((chunk: Uint8Array | string) => {
      passthrough.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as typeof process.stderr.write
    restore = divertStderr(false)
    process.stderr.write('\n\n  \nnoisy line\ntrailing without newline')
    restore()
    restore = undefined
    process.stderr.write('back on the restored passthrough\n')
    const body = await readLogBody(path, 'noisy line')
    expect(body).not.toContain('trailing without newline')
    expect(body).not.toContain('back on the restored passthrough')
    expect(passthrough.join('')).toContain('back on the restored passthrough')
  })
})
