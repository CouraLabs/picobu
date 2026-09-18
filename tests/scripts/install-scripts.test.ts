import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const scriptsDir = join(import.meta.dir, '../../scripts')
const installSh = readFileSync(join(scriptsDir, 'install.sh'), 'utf8')
const installPs1 = readFileSync(join(scriptsDir, 'install.ps1'), 'utf8')

describe('install.sh (npm install path)', () => {
  test('installs the global bun package with trust', () => {
    expect(installSh.includes('bun add -g')).toBe(true)
    expect(installSh.includes('--trust')).toBe(true)
    expect(installSh.includes('@couralabs/picobu')).toBe(true)
  })

  test('carries version markers for the publisher to stamp', () => {
    expect(installSh.includes('PICOBU_VERSION_DEFAULT="')).toBe(true)
    expect(installSh.includes('PUPPETEER_VERSION_DEFAULT="')).toBe(true)
    const dollar = String.fromCharCode(36)
    const overrideLine = `PICOBU_VERSION="${dollar}{PICOBU_VERSION:-${dollar}PICOBU_VERSION_DEFAULT}"`
    expect(installSh.includes(overrideLine)).toBe(true)
    expect(installSh.includes('browsers install chrome')).toBe(true)
  })

  test('each version marker appears exactly once (stable for stampInstallScripts)', () => {
    expect(installSh.match(/^PICOBU_VERSION_DEFAULT="[^"]*"$/gm)?.length).toBe(1)
    expect(installSh.match(/^PUPPETEER_VERSION_DEFAULT="[^"]*"$/gm)?.length).toBe(1)
  })

  test('no longer clones or compiles from source', () => {
    expect(installSh.includes('git clone')).toBe(false)
    expect(installSh.includes('bun scripts/build.ts')).toBe(false)
  })
})

describe('install.ps1 (npm install path)', () => {
  test('installs the global bun package with trust', () => {
    expect(installPs1.includes('bun add -g')).toBe(true)
    expect(installPs1.includes('--trust')).toBe(true)
    expect(installPs1.includes('@couralabs/picobu')).toBe(true)
  })

  test('carries version markers for the publisher to stamp', () => {
    expect(installPs1.includes("$PicobuVersionDefault = '")).toBe(true)
    expect(installPs1.includes("$PuppeteerVersionDefault = '")).toBe(true)
    expect(installPs1.includes('browsers install chrome')).toBe(true)
  })

  test('each version marker appears exactly once (stable for stampInstallScripts)', () => {
    expect(installPs1.match(/^\$PicobuVersionDefault = '[^']*'$/gm)?.length).toBe(1)
    expect(installPs1.match(/^\$PuppeteerVersionDefault = '[^']*'$/gm)?.length).toBe(1)
  })

  test('no longer clones or compiles from source', () => {
    expect(installPs1.includes('git clone')).toBe(false)
    expect(installPs1.includes('bun scripts/build.ts')).toBe(false)
  })
})
