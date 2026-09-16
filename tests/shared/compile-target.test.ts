import { describe, expect, test } from 'bun:test'
import { defaultOutfile, normalizeLibc, resolveCompileTarget } from '../../src/shared/compile-target.ts'

describe('resolveCompileTarget', () => {
  test('maps windows hosts to explicit windows targets', () => {
    expect(resolveCompileTarget('win32', 'x64').target).toBe('bun-windows-x64')
    expect(resolveCompileTarget('win32', 'arm64').target).toBe('bun-windows-arm64')
  })
  test('maps mac and linux hosts', () => {
    expect(resolveCompileTarget('darwin', 'arm64').target).toBe('bun-darwin-arm64')
    expect(resolveCompileTarget('darwin', 'x64').target).toBe('bun-darwin-x64')
    expect(resolveCompileTarget('linux', 'x64').target).toBe('bun-linux-x64')
    expect(resolveCompileTarget('linux', 'x64', 'musl').target).toBe('bun-linux-x64-musl')
    expect(resolveCompileTarget('linux', 'arm64', 'musl').target).toBe('bun-linux-arm64-musl')
  })
  test('rejects unsupported platforms', () => {
    expect(() => resolveCompileTarget('darwin', 'mips')).toThrow()
  })
  test('windows outfile keeps the exe extension', () => {
    expect(defaultOutfile('win32')).toBe('picobu.exe')
    expect(defaultOutfile('darwin')).toBe('picobu')
    expect(normalizeLibc('musl')).toBe('musl')
    expect(normalizeLibc(undefined)).toBe('glibc')
  })
})
