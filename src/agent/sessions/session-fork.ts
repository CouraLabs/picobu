import type { Session } from '@agent/sessions/session.ts'
import { folderKeyForSession, readSessionMeta, writeSessionMeta } from '@agent/sessions/session-meta.ts'
import { folderKeyFor, generateSessionId } from '@agent/sessions/session-paths.ts'
import { loadSession, writeSessionFile } from '@agent/sessions/session-store.ts'

export interface ForkDeps {
  cwd: string
  live: Map<string, Session>
  startSession: (id: string) => Promise<Session>
}

export function sliceMessagesUpTo<M extends { id: string }>(messages: Array<M>, messageId: string): Array<M> {
  const index = messages.findIndex((m) => m.id === messageId)
  if (index < 0) throw new Error(`Unknown message "${messageId}"`)
  return messages.slice(0, index + 1)
}

export async function forkSession(deps: ForkDeps, id: string, opts: { upToMessageId?: string } = {}): Promise<{ sessionId: string }> {
  const { cwd, live } = deps
  const sourceFolderKey = await folderKeyForSession(cwd, id)
  const source = live.get(id)
  if (source?.state === 'running') {
    throw new Error(`Session "${id}" is running; stop it before forking`)
  }
  const meta = await readSessionMeta(sourceFolderKey, id)
  if (!source && meta?.state === 'running') {
    throw new Error(`Session "${id}" is running; stop it before forking`)
  }
  await source?.flush()
  const messages = await loadSession(sourceFolderKey, id)
  if (!messages) throw new Error(`Unknown session "${id}"`)
  const forkedMessages = opts.upToMessageId ? sliceMessagesUpTo(messages, opts.upToMessageId) : messages
  const forkId = generateSessionId()
  const targetFolderKey = folderKeyFor(cwd)
  await writeSessionFile(targetFolderKey, forkId, forkedMessages)
  if (meta) {
    await writeSessionMeta(targetFolderKey, forkId, {
      ...meta,
      id: forkId,
      cwd,
      title: meta.title ? `${meta.title} (forked)` : '(forked)',
      parentSessionId: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
  const fork = await deps.startSession(forkId)
  return { sessionId: fork.id }
}
