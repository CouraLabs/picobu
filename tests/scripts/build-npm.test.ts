import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { npmExternalPackages, parseNpmBuildArgs, runtimeAssetCopies, selectEntryArtifact } from '../../scripts/build-npm.ts'

describe('parseNpmBuildArgs', () => {
  test('defaults to dist/, .tmp/npm-probe, src/cli.ts and the probe entry', () => {
    const args = parseNpmBuildArgs([])
    expect(args.outDir).toBe(join(import.meta.dir, '../../dist'))
    expect(args.probeDir).toBe(join(import.meta.dir, '../../.tmp/npm-probe'))
    expect(args.entry).toBe(join(import.meta.dir, '../../src/cli.ts'))
    expect(args.probeEntry).toBe(join(import.meta.dir, '../../scripts/npm-asset-probe.ts'))
    expect(args.quiet).toBe(false)
  })

  test('accepts --out-dir, --probe-dir and --quiet', () => {
    const args = parseNpmBuildArgs(['--out-dir', '/tmp/a', '--probe-dir', '/tmp/b', '--quiet'])
    expect(args.outDir).toBe('/tmp/a')
    expect(args.probeDir).toBe('/tmp/b')
    expect(args.quiet).toBe(true)
  })

  test('rejects a flag without a value', () => {
    expect(() => parseNpmBuildArgs(['--out-dir'])).toThrow()
    expect(() => parseNpmBuildArgs(['--out-dir', '--quiet'])).toThrow()
  })
})

describe('npmExternalPackages', () => {
  test('keeps reactivity, native and platform packages out of the bundle', () => {
    for (const pkg of ['@opentui/core', '@opentui/solid', '@opentui/solid/*', 'solid-js', 'solid-js/*', 'puppeteer', '@vscode/ripgrep', '@vscode/ripgrep-*', 'web-tree-sitter']) {
      expect(npmExternalPackages.includes(pkg)).toBe(true)
    }
  })

  test('is locked to an exact ordered list', () => {
    expect(npmExternalPackages).toEqual(['@opentui/core', '@opentui/solid', '@opentui/solid/*', 'solid-js', 'solid-js/*', 'puppeteer', '@vscode/ripgrep', '@vscode/ripgrep-*', 'web-tree-sitter'])
  })
})

describe('runtimeAssetCopies', () => {
  test('copies the builtin workflow markdown next to the bundle', () => {
    expect(runtimeAssetCopies('/repo')).toEqual([
      { from: join('/repo', 'src/agent/workflows/init.md'), to: 'init.md' },
      { from: join('/repo', 'src/agent/workflows/review.md'), to: 'review.md' },
    ])
  })
})

describe('selectEntryArtifact', () => {
  test('throws when no entry-point output exists', () => {
    expect(() => selectEntryArtifact([{ kind: 'asset', path: '/d/a.scm' }])).toThrow('build produced no entry point')
  })

  test('returns the entry-point output path', () => {
    expect(
      selectEntryArtifact([
        { kind: 'asset', path: '/d/a.scm' },
        { kind: 'entry-point', path: '/d/cli.js' },
      ]),
    ).toBe('/d/cli.js')
  })
})
