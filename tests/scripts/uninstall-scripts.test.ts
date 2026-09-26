import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const scriptsDir = join(import.meta.dir, '../../scripts')
const uninstallSh = readFileSync(join(scriptsDir, 'uninstall.sh'), 'utf8')
const uninstallPs1 = readFileSync(join(scriptsDir, 'uninstall.ps1'), 'utf8')

interface UninstallVariant {
  label: string
  file: string
  dataDirMarker: string
  pathMarker: string
}

const uninstallVariants: Array<UninstallVariant> = [
  {
    label: 'uninstall.sh',
    file: uninstallSh,
    dataDirMarker: 'rm -rf "$PICOBU_HOME"',
    pathMarker: 'export PATH="$HOME/.picobu/bin:$PATH"',
  },
  {
    label: 'uninstall.ps1',
    file: uninstallPs1,
    dataDirMarker: 'Remove-Item -Recurse -Force $PicobuHome',
    pathMarker: 'removed picobu bin from the user PATH',
  },
]

describe('uninstall scripts (npm install path)', () => {
  test.each(uninstallVariants)('$label removes the global package', (variant) => {
    expect(variant.file.includes('bun remove -g')).toBe(true)
    expect(variant.file.includes('@couralabs/picobu')).toBe(true)
  })

  test.each(uninstallVariants)('$label still deletes the data dir and legacy PATH entries', (variant) => {
    expect(variant.file.includes(variant.dataDirMarker)).toBe(true)
    expect(variant.file.includes(variant.pathMarker)).toBe(true)
  })

  test.each(uninstallVariants)('$label mentions the shared puppeteer cache', (variant) => {
    expect(variant.file.includes('puppeteer')).toBe(true)
  })
})
