export interface KeyLike {
  name: string
  ctrl: boolean
  meta: boolean
  shift?: boolean
  super?: boolean
}

const lowerName = (key: KeyLike): string => key.name.toLowerCase()

const ctrlOnly = (key: KeyLike): boolean => key.ctrl && !key.meta && !(key.super ?? false)

// Windows terminals report some ctrl+letter chords as alt+letter, so meta-only presses
// are accepted as a fallback there. On other platforms meta+letter is text input
// (e.g. option+o types 'ø') and must fall through to the prompt.
const metaOnly = (key: KeyLike, platform: string): boolean => platform === 'win32' && key.meta && !key.ctrl && !(key.super ?? false)

const matchesLetter = (key: KeyLike, letters: Array<string>, platform: string): boolean => {
  const name = lowerName(key)
  if (!letters.includes(name)) return false
  return ctrlOnly(key) || metaOnly(key, platform)
}

export const hasMod = (key: KeyLike): boolean => key.ctrl || key.meta || (key.super ?? false)

export const isHelpKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f1' || matchesLetter(key, ['h'], platform)

export const isModelKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f2' || matchesLetter(key, ['m', 'o'], platform)

export const isJobsKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f3' || matchesLetter(key, ['j'], platform)

export const isSteerKey = (key: KeyLike, platform: string = process.platform): boolean => lowerName(key) === 'f4' || matchesLetter(key, ['w'], platform)

// shift is excluded so ctrl+shift+d keeps reaching the textarea's default
// 'delete-line' binding instead of arming the exit window.
export const isExitKey = (key: KeyLike): boolean => lowerName(key) === 'f10' || (ctrlOnly(key) && !key.shift && lowerName(key) === 'd')
