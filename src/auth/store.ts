import { chmodSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { OAuthCredential } from '@auth/types.ts'
import { options } from '@config/options.ts'
import { atomicWriteFile } from '@shared/atomic-write.ts'
import { acquireLock } from '@shared/lock.ts'
export type AuthFile = Record<string, OAuthCredential>
const DEFAULT_PATH = join(options.app.systemDir, 'auth.json')
const MAX_CORRUPT_BACKUPS = 3
let authFilePath = DEFAULT_PATH
let cache: AuthFile | null = null
export const initAuthFilePath = (path: string): void => {
  authFilePath = path
  cache = null
}
export const resetAuthCache = (): void => {
  cache = null
}
export const authFilePathOf = (): string => authFilePath
const pruneCorruptBackups = (): void => {
  try {
    const prefix = `${basename(authFilePath)}.corrupt-`
    const stale = readdirSync(dirname(authFilePath))
      .filter((name) => name.startsWith(prefix))
      .sort()
      .slice(0, -MAX_CORRUPT_BACKUPS)
    for (const name of stale) rmSync(join(dirname(authFilePath), name), { force: true })
  } catch {}
}
export const readAuthFile = async (path: string): Promise<AuthFile> => {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return {}
    const parsed: unknown = await file.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as AuthFile
  } catch {
    try {
      const raw = await Bun.file(path).text()
      await Bun.write(`${path}.corrupt-${Date.now()}`, raw, { mode: 0o600 })
      pruneCorruptBackups()
    } catch {}
    return {}
  }
}
export const initAuth = async (): Promise<void> => {
  if (cache === null) cache = await readAuthFile(authFilePath)
}
export const listCredentials = (): AuthFile => cache ?? {}
export const getCredential = (id: string): OAuthCredential | undefined => listCredentials()[id]
const persist = async (mutate: (current: AuthFile) => AuthFile | null): Promise<AuthFile | null> => {
  await initAuth()
  const lock = await acquireLock(authFilePath)
  try {
    const current = await readAuthFile(authFilePath)
    const updated = mutate(current)
    if (updated === null) return null
    await atomicWriteFile(authFilePath, JSON.stringify(updated, null, 2), 0o600)
    try {
      chmodSync(authFilePath, 0o600)
    } catch {}
    cache = updated
    return updated
  } finally {
    lock.release()
  }
}
export const setCredential = async (id: string, credential: OAuthCredential): Promise<void> => {
  await persist((current) => ({ ...current, [id]: credential }))
}
export const removeCredential = async (id: string): Promise<boolean> => {
  return (
    (await persist((current) => {
      if (!current[id]) return null
      const { [id]: _removed, ...rest } = current
      return rest
    })) !== null
  )
}
