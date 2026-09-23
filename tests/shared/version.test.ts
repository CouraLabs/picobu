import { describe, expect, test } from 'bun:test'
import { bumpVersion, formatConsoleTitle, getVersion, parseVersion } from '../../src/shared/version.ts'

describe('version', () => {
  test('package version is 0.<features>.<build>', () => {
    expect(parseVersion(getVersion()).major).toBe(0)
  })
  test('build bump increments patch only', () => {
    expect(bumpVersion('0.2.3', 'build')).toBe('0.2.4')
  })
  test('feature bump increments minor and resets build', () => {
    expect(bumpVersion('0.2.3', 'feature')).toBe('0.3.0')
  })
  test('major is locked at 0', () => {
    expect(() => bumpVersion('1.0.0', 'build')).toThrow()
    expect(() => bumpVersion('2.0.0', 'build')).toThrow()
  })
  test('console title composes app name, session id and title', () => {
    expect(formatConsoleTitle('picobu')).toBe('picobu')
    expect(formatConsoleTitle('picobu', undefined, '  ')).toBe('picobu')
    expect(formatConsoleTitle('picobu', 'abc123')).toBe('picobu | abc123')
    expect(formatConsoleTitle('picobu', undefined, 'My session')).toBe('picobu | My session')
    expect(formatConsoleTitle('picobu', 'abc123', 'My session')).toBe('picobu | abc123 | My session')
  })
})
