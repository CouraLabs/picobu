export interface KeyLike {
  name: string
  ctrl: boolean
  meta: boolean
  super?: boolean
}

const lowerName = (key: KeyLike): string => key.name.toLowerCase()

const ctrlOnly = (key: KeyLike): boolean => key.ctrl && !key.meta && !(key.super ?? false)

const metaOnly = (key: KeyLike): boolean => key.meta && !key.ctrl && !(key.super ?? false)

const matchesLetter = (key: KeyLike, letters: Array<string>): boolean => {
  const name = lowerName(key)
  if (!letters.includes(name)) return false
  return ctrlOnly(key) || metaOnly(key)
}

export const hasMod = (key: KeyLike): boolean => key.ctrl || key.meta || (key.super ?? false)

export const isHelpKey = (key: KeyLike): boolean => lowerName(key) === 'f1' || matchesLetter(key, ['h'])

export const isModelKey = (key: KeyLike): boolean => lowerName(key) === 'f2' || matchesLetter(key, ['m', 'o'])

export const isJobsKey = (key: KeyLike): boolean => lowerName(key) === 'f3' || matchesLetter(key, ['j'])

export const isSteerKey = (key: KeyLike): boolean => lowerName(key) === 'f4' || matchesLetter(key, ['w'])

export const isExitKey = (key: KeyLike): boolean => lowerName(key) === 'f10' || (ctrlOnly(key) && lowerName(key) === 'd')
