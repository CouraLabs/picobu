import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const scriptsDir = join(import.meta.dir, '../../scripts')
const installSh = readFileSync(join(scriptsDir, 'install.sh'), 'utf8')
const installPs1 = readFileSync(join(scriptsDir, 'install.ps1'), 'utf8')

const dollar = String.fromCharCode(36)

interface InstallVariant {
  label: string
  file: string
  versionMarker: string
  puppeteerMarker: string
  versionPattern: string
  puppeteerPattern: string
  overrideLine?: string
}

const installVariants: Array<InstallVariant> = [
  {
    label: 'install.sh',
    file: installSh,
    versionMarker: 'PICOBU_VERSION_DEFAULT="',
    puppeteerMarker: 'PUPPETEER_VERSION_DEFAULT="',
    versionPattern: '^PICOBU_VERSION_DEFAULT="[^"]*"$',
    puppeteerPattern: '^PUPPETEER_VERSION_DEFAULT="[^"]*"$',
    overrideLine: `PICOBU_VERSION="${dollar}{PICOBU_VERSION:-${dollar}PICOBU_VERSION_DEFAULT}"`,
  },
  {
    label: 'install.ps1',
    file: installPs1,
    versionMarker: "$PicobuVersionDefault = '",
    puppeteerMarker: "$PuppeteerVersionDefault = '",
    versionPattern: "^\\$PicobuVersionDefault = '[^']*'$",
    puppeteerPattern: "^\\$PuppeteerVersionDefault = '[^']*'$",
  },
]

describe('install scripts (npm install path)', () => {
  test.each(installVariants)('$label installs the global bun package with trust', (variant) => {
    expect(variant.file.includes('bun add -g')).toBe(true)
    expect(variant.file.includes('--trust')).toBe(true)
    expect(variant.file.includes('@couralabs/picobu')).toBe(true)
  })

  test.each(installVariants)('$label carries version markers for the publisher to stamp', (variant) => {
    expect(variant.file.includes(variant.versionMarker)).toBe(true)
    expect(variant.file.includes(variant.puppeteerMarker)).toBe(true)
    if (variant.overrideLine !== undefined) expect(variant.file.includes(variant.overrideLine)).toBe(true)
    expect(variant.file.includes('browsers install chrome')).toBe(true)
  })

  test.each(installVariants)('$label keeps each version marker exactly once (stable for stampInstallScripts)', (variant) => {
    expect(variant.file.match(new RegExp(variant.versionPattern, 'gm'))?.length).toBe(1)
    expect(variant.file.match(new RegExp(variant.puppeteerPattern, 'gm'))?.length).toBe(1)
  })

  test.each(installVariants)('$label no longer clones or compiles from source', (variant) => {
    expect(variant.file.includes('git clone')).toBe(false)
    expect(variant.file.includes('bun scripts/build.ts')).toBe(false)
  })
})
