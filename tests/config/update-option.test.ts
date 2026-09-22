import { describe, expect, test } from 'bun:test'
import { DEFAULT_TUI_OPTIONS } from '../../src/config/options.ts'

describe('tui update option', () => {
  test('checkForUpdates defaults to true alongside maxMessages', () => {
    expect(DEFAULT_TUI_OPTIONS.checkForUpdates).toBe(true)
    expect(DEFAULT_TUI_OPTIONS.maxMessages).toBe(20)
  })
})
