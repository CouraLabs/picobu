import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { binaryPathFor, parseBuildArgs } from '../../scripts/build.ts'

describe('parseBuildArgs', () => {
  test('defaults to dist/ and src/cli.ts', () => {
    const args = parseBuildArgs([])
    expect(args.outDir).toBe(join(import.meta.dir, '../../dist'))
    expect(args.entry).toBe(join(import.meta.dir, '../../src/cli.ts'))
    expect(args.quiet).toBe(false)
  })

  test('accepts --out-dir and --entry', () => {
    const args = parseBuildArgs(['--out-dir', '/tmp/picobu-bin', '--entry', 'src/other.ts'])
    expect(args.outDir).toBe('/tmp/picobu-bin')
    expect(args.entry).toBe(join(import.meta.dir, '../../src/other.ts'))
  })

  test('accepts --quiet', () => {
    expect(parseBuildArgs(['--quiet']).quiet).toBe(true)
    expect(parseBuildArgs(['--out-dir', '/tmp/x', '--quiet']).quiet).toBe(true)
  })

  test('rejects a flag without a value', () => {
    expect(() => parseBuildArgs(['--out-dir'])).toThrow()
    expect(() => parseBuildArgs(['--out-dir', '--entry', 'src/cli.ts'])).toThrow()
  })
})

describe('binaryPathFor', () => {
  test('joins the outfile name per platform', () => {
    expect(binaryPathFor('/bin/dir', 'darwin')).toBe(join('/bin/dir', 'picobu'))
    expect(binaryPathFor('/bin/dir', 'linux')).toBe(join('/bin/dir', 'picobu'))
    expect(binaryPathFor('/bin/dir', 'win32')).toBe(join('/bin/dir', 'picobu.exe'))
  })
})
