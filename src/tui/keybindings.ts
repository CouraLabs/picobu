export interface KeyLike {
  name: string
  ctrl: boolean
  meta: boolean
  shift?: boolean
  super?: boolean
  sequence?: string
}

const lowerName = (key: KeyLike): string => key.name.toLowerCase()

const ctrlOnly = (key: KeyLike): boolean => key.ctrl && !key.meta && !(key.super ?? false)

// Windows terminals report some ctrl+letter chords as alt+letter, so meta-only presses
// are accepted as a fallback there. On other platforms meta+letter is text input
// (e.g. option+o types 'ø') and must fall through to the prompt.
const metaOnly = (key: KeyLike, platform: string): boolean => platform === 'win32' && key.meta && !key.ctrl && !(key.super ?? false)

// Windows legacy encoding sends ctrl+h as the 0x08 byte, which OpenTUI parses as plain
// backspace; a real Backspace sends 0x7F, so the raw sequence disambiguates them.
const legacyCtrlH = (key: KeyLike, platform: string): boolean => platform === 'win32' && key.name === 'backspace' && key.sequence === String.fromCharCode(8)

// The canonical chord is ctrl+shift+letter; plain ctrl+letter stays as an alias for
// terminals that cannot report Shift with Ctrl (no kitty protocol or modifyOtherKeys).
const matchesLetter = (key: KeyLike, letters: Array<string>, platform: string): boolean => {
  const name = lowerName(key)
  if (!letters.includes(name)) return false
  return ctrlOnly(key) || metaOnly(key, platform)
}

export const hasMod = (key: KeyLike): boolean => key.ctrl || key.meta || (key.super ?? false)

export const isHelpKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f1' || matchesLetter(key, ['h'], platform) || legacyCtrlH(key, platform)

export const isModelKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f2' || matchesLetter(key, ['m', 'o'], platform)

export const isJobsKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f3' || matchesLetter(key, ['j'], platform)

export const isSteerKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f4' || matchesLetter(key, ['w'], platform)

// ctrl+shift+d is the canonical exit chord; plain ctrl+d stays as an alias. Both chords
// are claimed away from the textarea's delete/delete-line defaults; the session handler
// preventDefaults before the textarea sees the key.
export const isExitKey = (key: KeyLike): boolean => lowerName(key) === 'f10' || (ctrlOnly(key) && lowerName(key) === 'd')

// Prompt-editing chords: shift is ignored so ctrl and ctrl+shift variants both work.
export const isCopyKey = (key: KeyLike): boolean => hasMod(key) && lowerName(key) === 'c'

export const isPasteKey = (key: KeyLike): boolean => hasMod(key) && lowerName(key) === 'v'

export const isSelectAllKey = (key: KeyLike): boolean => hasMod(key) && lowerName(key) === 'a'
