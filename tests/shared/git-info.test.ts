import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getGitInfo } from '../../src/shared/git-info.ts'

describe('getGitInfo', () => {
  test('detects the enclosing repo', () => {
    expect(getGitInfo(join(import.meta.dir, '..', '..'))).not.toBeNull()
  })
  test('returns null outside a repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'picobu-norepo-'))
    expect(getGitInfo(dir)).toBeNull()
  })
})
