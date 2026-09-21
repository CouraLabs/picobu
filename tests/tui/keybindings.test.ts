import { describe, expect, test } from 'bun:test'
import {
  DOUBLE_PRESS_WINDOW_MS,
  isClaimedChord,
  isCopyKey,
  isCycleEffortKey,
  isExitKey,
  isHelpKey,
  isJobsKey,
  isModelKey,
  isRepeatKey,
  isSelectAllKey,
  isSteerKey,
  type KeyLike,
} from '../../src/tui/keybindings.ts'

const key = (overrides: Partial<KeyLike> & { name: string }): KeyLike => ({ ctrl: false, meta: false, super: false, ...overrides })

describe('double-press window', () => {
  test('is 600ms', () => {
    expect(DOUBLE_PRESS_WINDOW_MS).toBe(600)
  })
})

describe('repeat guard', () => {
  test('ignores kitty repeats and repeated-flag presses, passes plain presses', () => {
    expect(isRepeatKey(key({ name: 'u', ctrl: true, eventType: 'repeat' }))).toBe(true)
    expect(isRepeatKey(key({ name: 'u', ctrl: true, repeated: true }))).toBe(true)
    expect(isRepeatKey(key({ name: 'u', ctrl: true, eventType: 'press' }))).toBe(false)
    expect(isRepeatKey(key({ name: 'u', ctrl: true, eventType: 'release' }))).toBe(false)
    expect(isRepeatKey(key({ name: 'escape', eventType: 'repeat' }))).toBe(true)
  })
})

describe('shortcut chords', () => {
  test('help fires on f1 only', () => {
    expect(isHelpKey(key({ name: 'f1' }))).toBe(true)
    expect(isHelpKey(key({ name: 'h', ctrl: true }))).toBe(false)
    expect(isHelpKey(key({ name: 'h', ctrl: true, shift: true }))).toBe(false)
    expect(isHelpKey(key({ name: 'h', meta: true }))).toBe(false)
    expect(isHelpKey(key({ name: 'h' }))).toBe(false)
  })
  test('alt+letter is left for text input outside windows', () => {
    expect(isModelKey(key({ name: 'u', meta: true }), 'darwin')).toBe(false)
    expect(isJobsKey(key({ name: 'k', meta: true }), 'linux')).toBe(false)
    expect(isSteerKey(key({ name: 'w', meta: true }), 'linux')).toBe(false)
    expect(isCycleEffortKey(key({ name: 'e', meta: true }), 'linux')).toBe(false)
  })
  test('ctrl-only guard rejects ctrl+meta combos', () => {
    expect(isModelKey(key({ name: 'u', ctrl: true, meta: true }))).toBe(false)
    expect(isJobsKey(key({ name: 'k', ctrl: true, meta: true }))).toBe(false)
    expect(isSteerKey(key({ name: 'w', ctrl: true, meta: true }))).toBe(false)
    expect(isCycleEffortKey(key({ name: 'e', ctrl: true, meta: true }))).toBe(false)
  })
  test('model fires on ctrl+u, ctrl+o, ctrl+shift+u, alt+u on windows, and f2', () => {
    expect(isModelKey(key({ name: 'u', ctrl: true }))).toBe(true)
    expect(isModelKey(key({ name: 'o', ctrl: true }))).toBe(true)
    expect(isModelKey(key({ name: 'u', ctrl: true, shift: true }))).toBe(true)
    expect(isModelKey(key({ name: 'o', ctrl: true, shift: true }))).toBe(true)
    expect(isModelKey(key({ name: 'u', meta: true }), 'win32')).toBe(true)
    expect(isModelKey(key({ name: 'o', meta: true }), 'win32')).toBe(true)
    expect(isModelKey(key({ name: 'f2' }))).toBe(true)
    expect(isModelKey(key({ name: 'm', ctrl: true }))).toBe(false)
    expect(isModelKey(key({ name: 'return', ctrl: true }))).toBe(false)
  })
  test('jobs fires on ctrl+k, ctrl+shift+k, alt+k on windows, and f3', () => {
    expect(isJobsKey(key({ name: 'k', ctrl: true }))).toBe(true)
    expect(isJobsKey(key({ name: 'k', ctrl: true, shift: true }))).toBe(true)
    expect(isJobsKey(key({ name: 'k', meta: true }), 'win32')).toBe(true)
    expect(isJobsKey(key({ name: 'f3' }))).toBe(true)
    expect(isJobsKey(key({ name: 'j', ctrl: true }))).toBe(false)
    expect(isJobsKey(key({ name: 'k' }))).toBe(false)
  })
  test('steer fires on ctrl+w, ctrl+shift+w, alt+w on windows, and f4', () => {
    expect(isSteerKey(key({ name: 'w', ctrl: true }))).toBe(true)
    expect(isSteerKey(key({ name: 'w', ctrl: true, shift: true }))).toBe(true)
    expect(isSteerKey(key({ name: 'w', meta: true }), 'win32')).toBe(true)
    expect(isSteerKey(key({ name: 'f4' }))).toBe(true)
    expect(isSteerKey(key({ name: 'w' }))).toBe(false)
  })
  test('effort fires on ctrl+e and ctrl+shift+e', () => {
    expect(isCycleEffortKey(key({ name: 'e', ctrl: true }))).toBe(true)
    expect(isCycleEffortKey(key({ name: 'e', ctrl: true, shift: true }))).toBe(true)
    expect(isCycleEffortKey(key({ name: 'e', meta: true }), 'win32')).toBe(true)
    expect(isCycleEffortKey(key({ name: 'e' }))).toBe(false)
  })
  test('exit fires on ctrl+d, ctrl+shift+d, and f10', () => {
    expect(isExitKey(key({ name: 'd', ctrl: true }))).toBe(true)
    expect(isExitKey(key({ name: 'd', ctrl: true, shift: true }))).toBe(true)
    expect(isExitKey(key({ name: 'f10' }))).toBe(true)
    expect(isExitKey(key({ name: 'd' }))).toBe(false)
  })
  test('copy and select-all fire with any mod, with or without shift', () => {
    expect(isCopyKey(key({ name: 'c', ctrl: true }))).toBe(true)
    expect(isCopyKey(key({ name: 'c', ctrl: true, shift: true }))).toBe(true)
    expect(isCopyKey(key({ name: 'c', meta: true }))).toBe(true)
    expect(isCopyKey(key({ name: 'c', super: true }))).toBe(true)
    expect(isCopyKey(key({ name: 'c' }))).toBe(false)
    expect(isSelectAllKey(key({ name: 'a', ctrl: true }))).toBe(true)
    expect(isSelectAllKey(key({ name: 'a', ctrl: true, shift: true }))).toBe(true)
    expect(isSelectAllKey(key({ name: 'a' }))).toBe(false)
  })
  test('claimed chords cover release-acted keys and tab in any shift state', () => {
    expect(isClaimedChord(key({ name: 'u', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'o', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'k', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'w', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'e', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'd', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'c', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'a', ctrl: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'tab' }))).toBe(true)
    expect(isClaimedChord(key({ name: 'tab', shift: true }))).toBe(true)
    expect(isClaimedChord(key({ name: 'x', ctrl: true }))).toBe(false)
    expect(isClaimedChord(key({ name: 'up' }))).toBe(false)
    expect(isClaimedChord(key({ name: 'escape' }))).toBe(false)
    expect(isClaimedChord(key({ name: 'f1' }))).toBe(false)
  })
  test('paste is not a keybinding', () => {
    expect(isClaimedChord(key({ name: 'v', ctrl: true }))).toBe(false)
  })
})
