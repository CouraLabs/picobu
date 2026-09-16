import { describe, expect, test } from 'bun:test'
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from '../../src/tui/terminal-win32.ts'

describe('terminal-win32 no-op safety off windows', () => {
  test('disable and flush never throw on posix', () => {
    expect(() => win32DisableProcessedInput()).not.toThrow()
    expect(() => win32FlushInputBuffer()).not.toThrow()
  })

  test('guard install returns undefined and never touches stdin on posix', () => {
    const before = process.stdin.setRawMode
    const unguard = win32InstallCtrlCGuard()
    expect(unguard).toBeUndefined()
    expect(process.stdin.setRawMode).toBe(before)
  })
})
