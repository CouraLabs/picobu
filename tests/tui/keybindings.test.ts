import { describe, expect, test } from 'bun:test'
import { isExitKey, isHelpKey, isJobsKey, isModelKey, isSteerKey, type KeyLike } from '../../src/tui/keybindings.ts'

const key = (overrides: Partial<KeyLike> & { name: string }): KeyLike => ({ ctrl: false, meta: false, super: false, ...overrides })

describe('windows fallback shortcuts', () => {
  test('help fires on ctrl+h, alt+h on windows, and f1', () => {
    expect(isHelpKey(key({ name: 'h', ctrl: true }))).toBe(true)
    expect(isHelpKey(key({ name: 'h', meta: true }), 'win32')).toBe(true)
    expect(isHelpKey(key({ name: 'f1' }))).toBe(true)
    expect(isHelpKey(key({ name: 'h' }))).toBe(false)
  })
  test('alt+letter is left for text input outside windows', () => {
    expect(isHelpKey(key({ name: 'h', meta: true }), 'darwin')).toBe(false)
    expect(isHelpKey(key({ name: 'h', meta: true }), 'linux')).toBe(false)
    expect(isModelKey(key({ name: 'o', meta: true }), 'darwin')).toBe(false)
    expect(isSteerKey(key({ name: 'w', meta: true }), 'linux')).toBe(false)
  })
  test('ctrl-only guard rejects ctrl+meta combos', () => {
    expect(isHelpKey(key({ name: 'h', ctrl: true, meta: true }))).toBe(false)
    expect(isHelpKey(key({ name: 'h', ctrl: true, meta: true }), 'win32')).toBe(false)
    expect(isModelKey(key({ name: 'm', ctrl: true, meta: true }))).toBe(false)
  })
  test('model fires on ctrl+m, ctrl+o, alt+m on windows, and f2', () => {
    expect(isModelKey(key({ name: 'm', ctrl: true }))).toBe(true)
    expect(isModelKey(key({ name: 'o', ctrl: true }))).toBe(true)
    expect(isModelKey(key({ name: 'm', meta: true }), 'win32')).toBe(true)
    expect(isModelKey(key({ name: 'f2' }))).toBe(true)
    expect(isModelKey(key({ name: 'return', ctrl: true }))).toBe(false)
  })
  test('jobs fires on ctrl+j, alt+j on windows, and f3', () => {
    expect(isJobsKey(key({ name: 'j', ctrl: true }))).toBe(true)
    expect(isJobsKey(key({ name: 'j', meta: true }), 'win32')).toBe(true)
    expect(isJobsKey(key({ name: 'f3' }))).toBe(true)
    expect(isJobsKey(key({ name: 'j' }))).toBe(false)
  })
  test('steer fires on ctrl+w, alt+w on windows, and f4', () => {
    expect(isSteerKey(key({ name: 'w', ctrl: true }))).toBe(true)
    expect(isSteerKey(key({ name: 'w', meta: true }), 'win32')).toBe(true)
    expect(isSteerKey(key({ name: 'f4' }))).toBe(true)
    expect(isSteerKey(key({ name: 'w' }))).toBe(false)
  })
  test('exit fires on double-press ctrl+d and on f10, but not on ctrl+shift+d', () => {
    expect(isExitKey(key({ name: 'd', ctrl: true }))).toBe(true)
    expect(isExitKey(key({ name: 'f10' }))).toBe(true)
    expect(isExitKey(key({ name: 'd' }))).toBe(false)
    expect(isExitKey(key({ name: 'd', ctrl: true, shift: true }))).toBe(false)
  })
})
