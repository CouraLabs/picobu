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

// The canonical chord is ctrl+letter; shift is ignored so terminals that report
// ctrl+shift+letter still match.
const matchesLetter = (key: KeyLike, letters: Array<string>, platform: string): boolean => {
  const name = lowerName(key)
  if (!letters.includes(name)) return false
  return ctrlOnly(key) || metaOnly(key, platform)
}

export const hasMod = (key: KeyLike): boolean => key.ctrl || key.meta || (key.super ?? false)

// Window for double-press chords (exit, esc esc interrupt).
export const DOUBLE_PRESS_WINDOW_MS = 200

export const isHelpKey = (key: KeyLike): boolean => lowerName(key) === 'f1'

export const isModelKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f2' || matchesLetter(key, ['u'], platform)

export const isJobsKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f3' || matchesLetter(key, ['k'], platform)

export const isSteerKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f4' || matchesLetter(key, ['w'], platform)

export const isCycleEffortKey = (key: KeyLike, platform: string = process.platform): boolean => matchesLetter(key, ['e'], platform)

export const isSandboxKey = (key: KeyLike, platform: string = process.platform): boolean => matchesLetter(key, ['p'], platform)

// ctrl+d is the exit chord. Both press and release are claimed away from the textarea's
// delete/delete-line defaults; the session handler preventDefaults before the textarea
// sees the key.
export const isExitKey = (key: KeyLike): boolean => lowerName(key) === 'f10' || (ctrlOnly(key) && lowerName(key) === 'd')

// Prompt-editing chords: shift is ignored so ctrl and ctrl+shift variants both work.
export const isCopyKey = (key: KeyLike): boolean => hasMod(key) && lowerName(key) === 'c'

export const isSelectAllKey = (key: KeyLike): boolean => hasMod(key) && lowerName(key) === 'a'

// Chords whose action runs on key release; a global handler preventDefaults the press
// so textarea defaults (delete-line, kill-line, line-home, ...) never fire. Tab is
// included in any shift state so an unhandled press cannot move renderer focus.
export const isClaimedChord = (key: KeyLike, platform: string = process.platform): boolean =>
  isModelKey(key, platform) ||
  isJobsKey(key, platform) ||
  isSteerKey(key, platform) ||
  isCycleEffortKey(key, platform) ||
  isSandboxKey(key, platform) ||
  isExitKey(key) ||
  isCopyKey(key) ||
  isSelectAllKey(key) ||
  lowerName(key) === 'tab'
