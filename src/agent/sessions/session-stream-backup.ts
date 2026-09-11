import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeMessages, settleAbortedToolParts, settleStreamingParts } from '@agent/sessions/session-messages.ts'
import { sessionsRoot } from '@agent/sessions/session-paths.ts'
import { withLock } from '@shared/lock.ts'
import type { UIMessage } from 'ai'

export const streamBackupPath = (folderKey: string, sessionId: string): string => join(sessionsRoot(), folderKey, `${sessionId}.stream.json`)

export async function writeStreamBackup(folderKey: string, sessionId: string, messages: UIMessage[]): Promise<void> {
  const path = streamBackupPath(folderKey, sessionId)
  await withLock(path, async () => {
    mkdirSync(join(sessionsRoot(), folderKey), { recursive: true })
    await writeFile(path, `${JSON.stringify(messages)}\n`)
  })
}

const isBackupMessage = (value: unknown): value is UIMessage => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' && typeof record.role === 'string' && Array.isArray(record.parts)
}

export async function readStreamBackup(folderKey: string, sessionId: string): Promise<UIMessage[] | undefined> {
  let raw: string
  try {
    raw = await readFile(streamBackupPath(folderKey, sessionId), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every(isBackupMessage)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export async function clearStreamBackup(folderKey: string, sessionId: string): Promise<void> {
  try {
    await rm(streamBackupPath(folderKey, sessionId), { force: true })
  } catch {}
}

export async function recoverStreamBackup(folderKey: string, sessionId: string): Promise<UIMessage[] | undefined> {
  const staged = await readStreamBackup(folderKey, sessionId)
  if (!staged || staged.length === 0) return undefined
  return sanitizeMessages(settleStreamingParts(settleAbortedToolParts(staged)))
}
