import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isInsideBase, resolveInsideBase } from '../../src/agent/tools/filesystem/paths.ts'

let root = ''
let outside = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'picobu-paths-root-'))
  outside = mkdtempSync(join(tmpdir(), 'picobu-paths-out-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('isInsideBase', () => {
  test('accepts paths inside the base', () => {
    expect(isInsideBase(root, join(root, 'a', 'b.txt'))).toBe(true)
    expect(isInsideBase(root, root)).toBe(true)
  })

  test('rejects ../ traversal with forward separators', () => {
    expect(isInsideBase(root, join(root, '..', 'secret.txt'))).toBe(false)
  })

  test('rejects absolute paths outside the base', () => {
    expect(isInsideBase(root, join(outside, 'secret.txt'))).toBe(false)
  })

  test('rejects a path that normalizes outside via multiple .. segments', () => {
    expect(isInsideBase(root, join(root, '..', '..', 'x'))).toBe(false)
  })
})

describe('resolveInsideBase', () => {
  test('resolves relative paths against the base', async () => {
    const resolved = await resolveInsideBase(root, 'a/b.txt')
    expect(resolved).toBe(join(root, 'a', 'b.txt'))
  })

  test('rejects traversal out of the base', async () => {
    await expect(resolveInsideBase(root, '../outside.txt')).rejects.toThrow('Path escapes working directory')
    await expect(resolveInsideBase(root, '../../etc/passwd')).rejects.toThrow('Path escapes working directory')
  })

  test('rejects absolute paths outside the base', async () => {
    await expect(resolveInsideBase(root, join(outside, 'secret.txt'))).rejects.toThrow('Path escapes working directory')
  })

  test('without a base, resolves against cwd without containment checks', async () => {
    const resolved = await resolveInsideBase(undefined, join(outside, 'secret.txt'))
    expect(resolved).toBe(join(outside, 'secret.txt'))
  })

  test('allows a symlink whose target is inside the base', async () => {
    writeFileSync(join(root, 'real.txt'), 'x')
    symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'))
    const resolved = await resolveInsideBase(root, 'link.txt')
    expect(resolved).toBe(join(root, 'link.txt'))
  })

  test('rejects a symlink whose target escapes the base', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(join(outside, 'secret.txt'), join(root, 'evil.txt'))
    await expect(resolveInsideBase(root, 'evil.txt')).rejects.toThrow('Path escapes working directory')
  })

  test('rejects a symlinked directory escaping the base', async () => {
    symlinkSync(outside, join(root, 'docs'))
    await expect(resolveInsideBase(root, join('docs', 'authorized_keys'))).rejects.toThrow('Path escapes working directory')
  })

  test('resolves through a nonexistent path whose existing ancestor is a symlink', async () => {
    symlinkSync(outside, join(root, 'docs'))
    await expect(resolveInsideBase(root, join('docs', 'new-file-that-does-not-exist.txt'))).rejects.toThrow('Path escapes working directory')
  })

  test('allows a new file inside a symlinked directory whose target is inside the base', async () => {
    const inner = join(root, 'inner')
    mkdirSync(inner, { recursive: true })
    symlinkSync(inner, join(root, 'alias'))
    const resolved = await resolveInsideBase(root, join('alias', 'new.txt'))
    expect(resolved).toBe(join(root, 'alias', 'new.txt'))
  })
})
