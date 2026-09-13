import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { grepTool } from '../../src/agent/tools/filesystem/grep.ts'

describe('grep line numbers', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'picobu-grep-'))
    await writeFile(join(dir, 'a.txt'), 'alpha one\nneedle here\nalpha three\n')
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'sub', 'b.txt'), 'first\nsecond needle\n')
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  test('every match carries path and line number', async () => {
    const out = await grepTool.handler({ pattern: 'needle', path: dir })
    const lines = out.content.split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(line).toMatch(/^.+:(\d+): .+$/)
    expect(out.content).toContain('a.txt:2: needle here')
    expect(out.content).toContain('b.txt:2: second needle')
  })
  test('single file search still names the file with its line', async () => {
    const out = await grepTool.handler({ pattern: 'needle', path: join(dir, 'a.txt') })
    expect(out.content).toContain('a.txt:2: needle here')
  })
  test('description promises the path line format', () => {
    expect(grepTool.description).toContain('path:line:')
  })
})
