import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const scriptsDir = join(import.meta.dir, '../../scripts')
const uninstallSh = readFileSync(join(scriptsDir, 'uninstall.sh'), 'utf8')
const uninstallPs1 = readFileSync(join(scriptsDir, 'uninstall.ps1'), 'utf8')

describe('uninstall.sh (npm install path)', () => {
  test('removes the global package', () => {
    expect(uninstallSh.includes('bun remove -g')).toBe(true)
    expect(uninstallSh.includes('@couralabs/picobu')).toBe(true)
  })

  test('still deletes the data dir and legacy PATH entries', () => {
    expect(uninstallSh.includes('rm -rf "$PICOBU_HOME"')).toBe(true)
    expect(uninstallSh.includes('export PATH="$HOME/.picobu/bin:$PATH"')).toBe(true)
  })

  test('mentions the shared puppeteer cache', () => {
    expect(uninstallSh.includes('puppeteer')).toBe(true)
  })
})

describe('uninstall.ps1 (npm install path)', () => {
  test('removes the global package', () => {
    expect(uninstallPs1.includes('bun remove -g')).toBe(true)
    expect(uninstallPs1.includes('@couralabs/picobu')).toBe(true)
  })

  test('still deletes the data dir and legacy PATH entries', () => {
    expect(uninstallPs1.includes('Remove-Item -Recurse -Force $PicobuHome')).toBe(true)
    expect(uninstallPs1.includes('removed picobu bin from the user PATH')).toBe(true)
  })

  test('mentions the shared puppeteer cache', () => {
    expect(uninstallPs1.includes('puppeteer')).toBe(true)
  })
})
