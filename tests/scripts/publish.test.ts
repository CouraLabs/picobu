import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertPackList, normalizeDependencyRange, packListFromOutput, parsePublishArgs, stampInstallScripts } from '../../scripts/publish.ts'

describe('parsePublishArgs', () => {
  test('defaults to a build bump with everything enabled', () => {
    expect(parsePublishArgs([])).toEqual({ kind: 'build', ci: false, skipChecks: false, skipGit: false, assumeYes: false, otp: undefined })
  })

  test('accepts feature aliases', () => {
    expect(parsePublishArgs(['--feature']).kind).toBe('feature')
    expect(parsePublishArgs(['-f']).kind).toBe('feature')
    expect(parsePublishArgs(['--minor']).kind).toBe('feature')
    expect(parsePublishArgs(['--build']).kind).toBe('build')
  })

  test('accepts an explicit --bump value', () => {
    expect(parsePublishArgs(['--bump', 'feature']).kind).toBe('feature')
    expect(parsePublishArgs(['--bump', 'build']).kind).toBe('build')
    expect(() => parsePublishArgs(['--bump', 'patch'])).toThrow('--bump requires "build" or "feature"')
  })

  test('implies assumeYes in ci mode', () => {
    expect(parsePublishArgs(['--ci', '--skip-checks', '--skip-git'])).toEqual({ kind: 'build', ci: true, skipChecks: true, skipGit: true, assumeYes: true, otp: undefined })
  })

  test('accepts an --otp value and rejects a missing one', () => {
    expect(parsePublishArgs(['--otp', '123456']).otp).toBe('123456')
    expect(() => parsePublishArgs(['--otp'])).toThrow('--otp requires')
    expect(() => parsePublishArgs(['--otp', '--ci'])).toThrow('--otp requires')
  })
})

describe('normalizeDependencyRange', () => {
  test('strips range operators', () => {
    expect(normalizeDependencyRange('^25.10.0')).toBe('25.10.0')
    expect(normalizeDependencyRange('~1.2.3')).toBe('1.2.3')
    expect(normalizeDependencyRange('>=7.0.0-rc14')).toBe('7.0.0-rc14')
    expect(normalizeDependencyRange('1.2.3')).toBe('1.2.3')
  })
})

describe('stampInstallScripts', () => {
  const stamp = { picobuVersion: '1.30.0', puppeteerVersion: '25.10.0' }
  const shContent = readFileSync(join(import.meta.dir, '../../scripts/install.sh'), 'utf8')
  const ps1Content = readFileSync(join(import.meta.dir, '../../scripts/install.ps1'), 'utf8')

  test('stamps install.sh once and keeps the env override line', () => {
    const stamped = stampInstallScripts(shContent, stamp, 'sh')
    expect(stamped.includes('PICOBU_VERSION_DEFAULT="1.30.0"')).toBe(true)
    expect(stamped.includes('PUPPETEER_VERSION_DEFAULT="25.10.0"')).toBe(true)
    const dollar = String.fromCharCode(36)
    expect(stamped.includes(`PICOBU_VERSION="${dollar}{PICOBU_VERSION:-${dollar}PICOBU_VERSION_DEFAULT}"`)).toBe(true)
  })

  test('stamping install.sh is idempotent', () => {
    expect(stampInstallScripts(stampInstallScripts(shContent, stamp, 'sh'), stamp, 'sh')).toBe(stampInstallScripts(shContent, stamp, 'sh'))
  })

  test('throws when an install.sh marker is missing', () => {
    expect(() => stampInstallScripts('nope', stamp, 'sh')).toThrow('install script marker not found')
  })

  test('stamps install.ps1 once', () => {
    const stamped = stampInstallScripts(ps1Content, stamp, 'ps1')
    expect(stamped.includes("$PicobuVersionDefault = '1.30.0'")).toBe(true)
    expect(stamped.includes("$PuppeteerVersionDefault = '25.10.0'")).toBe(true)
    expect(stampInstallScripts(stampInstallScripts(ps1Content, stamp, 'ps1'), stamp, 'ps1')).toBe(stamped)
    expect(() => stampInstallScripts('nope', stamp, 'ps1')).toThrow('install script marker not found')
  })
})

describe('packListFromOutput', () => {
  test('parses bun pm pack --dry-run output', () => {
    const output = [
      'bun pack v1.4.2 (744846f84)',
      '',
      'packed 118B package.json',
      'packed 37B bin/picobu.mjs',
      'packed 19B dist/cli.js',
      '',
      'probe-picobu-1.0.0.tgz',
      '',
      'Total files: 3',
      'Unpacked size: 174B',
      '',
    ].join('\n')
    expect(packListFromOutput(output)).toEqual(['package.json', 'bin/picobu.mjs', 'dist/cli.js'])
  })
})

describe('assertPackList', () => {
  const good = ['package.json', 'bin/picobu.mjs', 'dist/cli.js', 'dist/init.md', 'dist/review.md', 'dist/python-a1b2c3.wasm', 'dist/python-d4e5f6.scm']

  test('accepts a complete tarball file list', () => {
    expect(() => assertPackList(good, '1.30.0')).not.toThrow()
  })

  test('rejects a list missing a required file', () => {
    expect(() =>
      assertPackList(
        good.filter((f) => f !== 'dist/review.md'),
        '1.30.0',
      ),
    ).toThrow('dist/review.md')
  })

  test('rejects leaked source files', () => {
    expect(() => assertPackList([...good, 'src/cli.ts'], '1.30.0')).toThrow('src/cli.ts')
  })

  test('rejects a list without parser assets', () => {
    expect(() =>
      assertPackList(
        good.filter((f) => !f.endsWith('.wasm')),
        '1.30.0',
      ),
    ).toThrow('parser assets')
  })
})
