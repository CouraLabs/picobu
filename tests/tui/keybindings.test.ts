import { describe, expect, test } from 'bun:test'
import { isClaimedChord, isCopyKey, isCycleEffortKey, isExitKey, isHelpKey, isJobsKey, isModelKey, isRepeatKey, isSelectAllKey, isSteerKey, type KeyLike } from '../../src/tui/keybindings.ts'

const key = (overrides: Partial<KeyLike> & { name: string }): KeyLike => ({ ctrl: false, meta: false, super: false, ...overrides })

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
  interface ChordCase {
    label: string
    predicate: (key: KeyLike, platform?: string) => boolean
    positives: Array<Partial<KeyLike> & { name: string }>
    win32Metas: Array<string>
    negatives: Array<Partial<KeyLike> & { name: string }>
    fKey: string
  }
  const chordCases: Array<ChordCase> = [
    {
      label: 'model',
      predicate: isModelKey,
      positives: [
        { name: 'u', ctrl: true },
        { name: 'o', ctrl: true },
        { name: 'u', ctrl: true, shift: true },
        { name: 'o', ctrl: true, shift: true },
      ],
      win32Metas: ['u', 'o'],
      negatives: [
        { name: 'm', ctrl: true },
        { name: 'return', ctrl: true },
      ],
      fKey: 'f2',
    },
    {
      label: 'jobs',
      predicate: isJobsKey,
      positives: [
        { name: 'k', ctrl: true },
        { name: 'k', ctrl: true, shift: true },
      ],
      win32Metas: ['k'],
      negatives: [{ name: 'j', ctrl: true }, { name: 'k' }],
      fKey: 'f3',
    },
    {
      label: 'steer',
      predicate: isSteerKey,
      positives: [
        { name: 'w', ctrl: true },
        { name: 'w', ctrl: true, shift: true },
      ],
      win32Metas: ['w'],
      negatives: [{ name: 'w' }],
      fKey: 'f4',
    },
    {
      label: 'effort',
      predicate: isCycleEffortKey,
      positives: [
        { name: 'e', ctrl: true },
        { name: 'e', ctrl: true, shift: true },
      ],
      win32Metas: ['e'],
      negatives: [{ name: 'e' }],
      fKey: '',
    },
  ]
  test.each(chordCases)('$label fires on its chord, win32 meta fallback and f-key', (chord) => {
    for (const positive of chord.positives) expect(chord.predicate(key(positive))).toBe(true)
    for (const letter of chord.win32Metas) expect(chord.predicate(key({ name: letter, meta: true }), 'win32')).toBe(true)
    if (chord.fKey) expect(chord.predicate(key({ name: chord.fKey }))).toBe(true)
    for (const negative of chord.negatives) expect(chord.predicate(key(negative))).toBe(false)
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
  test('claimed chords cover tab in any shift state', () => {
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
