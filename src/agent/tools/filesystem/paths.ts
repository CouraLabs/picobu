import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { logDebug } from '@shared/logger.ts'

export const isInsideBase = (base: string, candidate: string): boolean => {
  const rel = relative(resolve(base), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const deepestRealpath = async (path: string): Promise<string> => {
  let current = resolve(path)
  for (;;) {
    try {
      return await realpath(current)
    } catch (error) {
      logDebug('swallowed error', { scope: 'paths', error })
    }
    const parent = resolve(current, '..')
    if (parent === current) return current
    current = parent
  }
}

export const resolveInsideBase = async (base: string | undefined, userPath: string): Promise<string> => {
  const resolved = resolve(base ?? process.cwd(), userPath)
  if (!base) return resolved
  const normalizedBase = resolve(base)
  if (!isInsideBase(normalizedBase, resolved)) throw new Error(`Path escapes working directory: ${userPath}`)
  const [realTarget, realBase] = await Promise.all([deepestRealpath(resolved), deepestRealpath(normalizedBase)])
  if (!isInsideBase(realBase, realTarget)) throw new Error(`Path escapes working directory: ${userPath}`)
  return resolved
}
