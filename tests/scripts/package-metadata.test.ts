import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name?: unknown
  version?: unknown
  private?: unknown
  bin?: unknown
  files?: unknown
  module?: unknown
  engines?: { bun?: unknown }
  license?: unknown
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
  scripts?: Record<string, string>
}

describe('package publish metadata', () => {
  test('name is the scoped package and the package is publishable', () => {
    expect(pkg.name).toBe('@couralabs/picobu')
    expect('private' in pkg).toBe(false)
  })

  test('bin, files, module, engines and license are set for the npm payload', () => {
    expect(pkg.bin).toEqual({ picobu: './bin/picobu.mjs' })
    expect(pkg.files).toEqual(['bin', 'dist'])
    expect(pkg.module).toBe('dist/cli.js')
    expect(pkg.engines?.bun).toBe('>=1.3.0')
    expect(pkg.license).toBe('MIT')
  })

  test('runtime deps needed by the bundle are declared', () => {
    expect(pkg.dependencies?.['solid-js']).toBe('1.9.12')
    expect(pkg.dependencies?.['web-tree-sitter']).toBe('0.25.10')
    expect(Object.keys(pkg.peerDependencies ?? {})).not.toContain('solid-js')
    expect(pkg.peerDependenciesMeta?.typescript?.optional).toBe(true)
  })

  test('release script is wired', () => {
    expect(pkg.scripts?.release).toBe('bun scripts/publish.ts')
  })

  test('bin shim exists with a bun shebang', () => {
    const binPath = join(root, 'bin/picobu.mjs')
    expect(existsSync(binPath)).toBe(true)
    expect(readFileSync(binPath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env bun')
  })

  test('LICENSE exists for the declared MIT license', () => {
    expect(existsSync(join(root, 'LICENSE'))).toBe(true)
  })
})
