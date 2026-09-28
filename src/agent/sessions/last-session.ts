import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { folderKeyFor } from '@agent/sessions/session-paths.ts'
import { options } from '@config/options.ts'
import { logDebug } from '@shared/logger.ts'

export interface LastSession {
  sessionId: string
  cwd: string
  at: number
}

export interface LastSessionLaunchPlan {
  sessionId?: string
  cwd?: string
}

export const lastSessionPath = (dir: string = options.app.systemDir): string => join(dir, 'last-session.json')

export const writeLastSession = (entry: LastSession, dir: string = options.app.systemDir): void => {
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(lastSessionPath(dir), `${JSON.stringify(entry, null, 2)}\n`)
  } catch (error) {
    logDebug('swallowed error', { scope: 'last-session', error })
  }
}

export const readLastSession = (dir: string = options.app.systemDir): LastSession | undefined => {
  let raw: string
  try {
    raw = readFileSync(lastSessionPath(dir), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as { sessionId?: unknown; cwd?: unknown; at?: unknown }
    if (typeof parsed.sessionId !== 'string' || parsed.sessionId.length === 0) return undefined
    if (typeof parsed.cwd !== 'string' || parsed.cwd.length === 0) return undefined
    return { sessionId: parsed.sessionId, cwd: parsed.cwd, at: typeof parsed.at === 'number' ? parsed.at : 0 }
  } catch {
    return undefined
  }
}

export const sessionExists = (entry: LastSession, dir: string = options.app.systemDir): boolean => {
  const folderKey = folderKeyFor(entry.cwd)
  const dirPath = join(dir, 'sessions', folderKey)
  return existsSync(join(dirPath, `${entry.sessionId}.meta.json`)) || existsSync(join(dirPath, `${entry.sessionId}.jsonl`))
}

export const lastSessionLaunchPlan = (dir: string = options.app.systemDir): LastSessionLaunchPlan => {
  const entry = readLastSession(dir)
  if (!entry || !sessionExists(entry, dir)) return {}
  return { sessionId: entry.sessionId, cwd: entry.cwd }
}
