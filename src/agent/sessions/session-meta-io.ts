import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { metaSchema, type SessionMeta } from '@agent/sessions/session-meta-schema.ts'
import { folderKeyFor, sessionsRoot } from '@agent/sessions/session-paths.ts'
import { withLock } from '@shared/lock.ts'

export const sessionMetaPath = (folderKey: string, sessionId: string): string => join(sessionsRoot(), folderKey, `${sessionId}.meta.json`)

export async function readSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  let raw: string
  try {
    raw = await readFile(sessionMetaPath(folderKey, sessionId), 'utf8')
  } catch {
    return null
  }
  try {
    return metaSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function writeSessionMeta(folderKey: string, sessionId: string, meta: SessionMeta): Promise<void> {
  const path = sessionMetaPath(folderKey, sessionId)
  await withLock(path, async () => {
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(meta, null, 2)}\n`)
  })
}

export async function folderKeyForSession(cwd: string, sessionId: string): Promise<string> {
  const meta = await readSessionMeta(folderKeyFor(cwd), sessionId)
  return folderKeyFor(meta?.cwd ?? cwd)
}

export async function updateSessionMeta(folderKey: string, sessionId: string, patch: Partial<Omit<SessionMeta, 'id'>>): Promise<SessionMeta | null> {
  const path = sessionMetaPath(folderKey, sessionId)
  return withLock(path, async () => {
    let current: SessionMeta | null = null
    try {
      current = metaSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    } catch {
      return null
    }
    const next: SessionMeta = { ...current, ...patch, id: sessionId, updatedAt: Date.now() }
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`)
    return next
  })
}

export async function deleteSessionMeta(folderKey: string, sessionId: string): Promise<void> {
  try {
    await rm(sessionMetaPath(folderKey, sessionId), { force: true })
  } catch {}
}

export async function recoverSessionMeta(folderKey: string, sessionId: string): Promise<SessionMeta | null> {
  const meta = await readSessionMeta(folderKey, sessionId)
  if (meta?.state !== 'running') return meta
  return updateSessionMeta(folderKey, sessionId, { state: 'error' })
}
