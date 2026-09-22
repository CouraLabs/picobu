import { describe, expect, test } from 'bun:test'
import { bumpVersion, compareVersions, formatConsoleTitle, getVersion, parseVersion } from '../../src/shared/version.ts'

describe('version', () => {
  test('package version is 1.<features>.<build>', () => {
    expect(parseVersion(getVersion()).major).toBe(1)
  })
  test('build bump increments patch only', () => {
    expect(bumpVersion('1.2.3', 'build')).toBe('1.2.4')
  })
  test('feature bump increments minor and resets build', () => {
    expect(bumpVersion('1.2.3', 'feature')).toBe('1.3.0')
  })
  test('major is locked at 1', () => {
    expect(() => bumpVersion('2.0.0', 'build')).toThrow()
  })
  test('console title falls back to version only', () => {
    expect(formatConsoleTitle(undefined)).toBe(`Picobu v${getVersion()}`)
    expect(formatConsoleTitle('  ')).toBe(`Picobu v${getVersion()}`)
    expect(formatConsoleTitle('My session')).toBe(`Picobu v${getVersion()} - My session`)
  })
  test('compareVersions orders by major, minor then patch', () => {
    expect(compareVersions('1.31.0', '1.30.9')).toBe(1)
    expect(compareVersions('1.31.0', '1.31.0')).toBe(0)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
    expect(compareVersions('1.2.10', '1.2.9')).toBe(1)
  })
  test('compareVersions rejects malformed versions', () => {
    expect(() => compareVersions('1.2', '1.2.3')).toThrow()
  })
})
