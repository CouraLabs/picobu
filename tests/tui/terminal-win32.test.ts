import { describe, expect, test } from 'bun:test'
import { win32DisableProcessedInput, win32FlushInputBuffer, win32InstallCtrlCGuard } from '../../src/tui/terminal-win32.ts'

describe('terminal-win32 no-op safety off windows', () => {
  test('helpers never throw and never touch stdin on posix', () => {
    expect(() => win32DisableProcessedInput()).not.toThrow()
    expect(() => win32FlushInputBuffer()).not.toThrow()
    const before = process.stdin.setRawMode
    const unguard = win32InstallCtrlCGuard()
    expect(unguard).toBeUndefined()
    expect(process.stdin.setRawMode).toBe(before)
  })
})
