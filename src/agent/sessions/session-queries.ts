import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Session } from '@agent/sessions/session.ts'
import type { JobTracker } from '@agent/sessions/session-jobs.ts'
import { deleteSessionMeta, folderKeyForSession, readSessionMeta, recoverSessionMeta, type SessionMeta, type SessionState } from '@agent/sessions/session-meta.ts'
import { folderKeyFor, sessionFilePath } from '@agent/sessions/session-paths.ts'
import { listSessions } from '@agent/sessions/session-store.ts'
import { options } from '@config/options.ts'

export interface SessionListRow {
  id: string
  mtimeMs: number
  firstPrompt: string
  title?: string
  state: SessionState
  parentSessionId?: string
  cwd?: string
}

export interface QueryDeps {
  cwd: string
  live: Map<string, Session>
  jobs: JobTracker
}

export async function listSessionsFor(deps: QueryDeps): Promise<Array<SessionListRow>> {
  const { cwd } = deps
  const folderKey = folderKeyFor(cwd)
  const rows = await listSessions(folderKey)
  const out: Array<SessionListRow> = []
  for (const row of rows) {
    const meta = await readSessionMeta(folderKey, row.id)
    if (meta && meta.cwd !== cwd) continue
    out.push({
      ...row,
      title: meta?.title,
      state: meta?.state ?? 'finished',
      parentSessionId: meta?.parentSessionId,
      cwd: meta?.cwd,
    })
  }
  return out
}

export async function listSessionTree(cwd: string): Promise<Array<SessionMeta & { children: Array<SessionMeta> }>> {
  const folderKey = folderKeyFor(cwd)
  const metas = await readAllMetas(folderKey, cwd)
  const childrenOf = (parentId: string): Array<SessionMeta> => metas.filter((m) => m.parentSessionId === parentId)
  return metas.filter((m) => !m.parentSessionId).map((root) => ({ ...root, children: childrenOf(root.id) }))
}

export async function deleteSessionCascade(deps: QueryDeps, id: string): Promise<number> {
  const { cwd, live, jobs } = deps
  const folderKey = await folderKeyForSession(cwd, id)
  const subtree = await collectSubtree(folderKey, cwd, id)
  for (const nodeId of subtree) {
    if (!live.has(nodeId)) await recoverSessionMeta(folderKey, nodeId)
    const running = live.get(nodeId)?.state === 'running' || (!live.has(nodeId) && (await readSessionMeta(folderKey, nodeId))?.state === 'running')
    if (running) throw new Error(`Session "${nodeId}" is running; stop it before deleting`)
  }
  for (const nodeId of subtree) {
    live.get(nodeId)?.abort()
    live.delete(nodeId)
    jobs.delete(nodeId)
    await rm(sessionFilePath(folderKey, nodeId), { force: true })
    await deleteSessionMeta(folderKey, nodeId)
    await rm(join(options.app.systemDir, 'sessions', folderKey, nodeId), { recursive: true, force: true }).catch(() => {})
  }
  return subtree.length
}

async function collectSubtree(folderKey: string, cwd: string, rootId: string): Promise<Array<string>> {
  const allMetas = await readAllMetas(folderKey, cwd)
  if (!allMetas.some((meta) => meta.id === rootId)) throw new Error(`Unknown session "${rootId}"`)
  const byParent = new Map<string, Array<string>>()
  for (const meta of allMetas) {
    if (!meta.parentSessionId) continue
    const list = byParent.get(meta.parentSessionId) ?? []
    list.push(meta.id)
    byParent.set(meta.parentSessionId, list)
  }
  const out = [rootId]
  const queue = [rootId]
  while (queue.length) {
    const next = queue.shift()
    if (!next) break
    for (const childId of byParent.get(next) ?? []) {
      out.push(childId)
      queue.push(childId)
    }
  }
  return out
}

async function readAllMetas(folderKey: string, cwd: string): Promise<Array<SessionMeta>> {
  let names: Array<string>
  try {
    names = (await readdir(join(options.app.systemDir, 'sessions', folderKey))).filter((n) => n.endsWith('.meta.json')).map((n) => n.slice(0, -'.meta.json'.length))
  } catch {
    return []
  }
  const metas = await Promise.all(names.map((id) => readSessionMeta(folderKey, id)))
  return metas.filter((m): m is SessionMeta => m !== null && m.cwd === cwd)
}
