import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { options } from '@config/options.ts'

export const PROMPT_HISTORY_LIMIT = 20
const PROMPT_HISTORY_PRUNE = 100

export const promptsDbPath = (): string => join(options.app.systemDir, 'prompts.db')
const legacyHistoryPath = (): string => join(options.app.systemDir, 'prompt-history.json')

export function projectKeyFor(cwd?: string): string {
  const raw = (cwd ?? options.app.cwd ?? '').trim()
  if (!raw) return 'default'
  const abs = resolve(raw)
  const base =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'default'
  const hash = createHash('sha1').update(abs).digest('hex').slice(0, 8)
  return `${base}-${hash}`
}

let db: Database | null = null
let dbPathCached = ''
let legacyMigrated = false

function getDb(): Database {
  const path = promptsDbPath()
  if (db && dbPathCached === path) return db
  try {
    db?.close()
  } catch {}
  db = null
  mkdirSync(options.app.systemDir, { recursive: true })
  const next = new Database(path, { create: true })
  next.exec('PRAGMA journal_mode = WAL;')
  next.exec('PRAGMA busy_timeout = 5000;')
  next.exec('PRAGMA synchronous = NORMAL;')
  next.exec('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, body_b64 TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(project, body_b64));')
  next.exec('CREATE TABLE IF NOT EXISTS draft (project TEXT PRIMARY KEY, body_b64 TEXT NOT NULL, updated_at INTEGER NOT NULL);')
  next.exec('CREATE INDEX IF NOT EXISTS idx_history_project_id ON history(project, id);')
  db = next
  dbPathCached = path
  return next
}

export function closePromptHistory(): void {
  try {
    db?.close()
  } catch {}
  db = null
  dbPathCached = ''
}

export function resetPromptHistoryCache(): void {
  closePromptHistory()
  legacyMigrated = false
}

export function flushPromptHistory(): Promise<void> {
  return Promise.resolve()
}

const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64')
const decode = (b64: string): string | undefined => {
  try {
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return undefined
  }
}

function migrateLegacy(project: string): void {
  if (legacyMigrated) return
  legacyMigrated = true
  const path = legacyHistoryPath()
  if (!existsSync(path)) return
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { prompts?: unknown }
    const list = Array.isArray(parsed.prompts) ? parsed.prompts.filter((p): p is string => typeof p === 'string') : []
    if (list.length === 0) {
      rmSync(path, { force: true })
      return
    }
    const database = getDb()
    const insert = database.prepare('INSERT OR IGNORE INTO history (project, body_b64, created_at) VALUES (?, ?, ?)')
    const now = Date.now()
    const run = database.transaction((items: Array<string>) => {
      for (const item of items) {
        const trimmed = item.trim()
        if (!trimmed) continue
        insert.run(project, encode(trimmed), now)
      }
    })
    run(list.slice(-PROMPT_HISTORY_LIMIT))
    rmSync(path, { force: true })
  } catch {}
}

export function loadPromptHistory(projectKey?: string): Array<string> {
  const project = projectKey ?? projectKeyFor()
  try {
    const database = getDb()
    migrateLegacy(project)
    const rows = database.query('SELECT body_b64 AS b FROM history WHERE project = ? ORDER BY id DESC LIMIT ?').all(project, PROMPT_HISTORY_LIMIT) as Array<{ b: string }>
    const out: Array<string> = []
    for (let i = rows.length - 1; i >= 0; i--) {
      const text = decode(rows[i]?.b ?? '')
      if (text !== undefined && text.trim().length > 0) out.push(text)
    }
    return out
  } catch {
    return []
  }
}

export function addPrompt(text: string, projectKey?: string): Array<string> {
  const project = projectKey ?? projectKeyFor()
  const trimmed = text.trim()
  if (!trimmed) return loadPromptHistory(project)
  try {
    const database = getDb()
    migrateLegacy(project)
    const body = encode(trimmed)
    const now = Date.now()
    const run = database.transaction(() => {
      database.prepare('DELETE FROM history WHERE project = ? AND body_b64 = ?').run(project, body)
      database.prepare('INSERT INTO history (project, body_b64, created_at) VALUES (?, ?, ?)').run(project, body, now)
      database.prepare('DELETE FROM history WHERE project = ? AND id NOT IN (SELECT id FROM history WHERE project = ? ORDER BY id DESC LIMIT ?)').run(project, project, PROMPT_HISTORY_PRUNE)
    })
    run()
  } catch {}
  return loadPromptHistory(project)
}

export function loadDraft(projectKey?: string): string {
  const project = projectKey ?? projectKeyFor()
  try {
    const database = getDb()
    const row = database.query('SELECT body_b64 AS b FROM draft WHERE project = ?').get(project) as { b: string } | null
    if (!row) return ''
    return decode(row.b) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string, projectKey?: string): void {
  const project = projectKey ?? projectKeyFor()
  try {
    const database = getDb()
    database
      .prepare('INSERT INTO draft (project, body_b64, updated_at) VALUES (?, ?, ?) ON CONFLICT(project) DO UPDATE SET body_b64 = excluded.body_b64, updated_at = excluded.updated_at')
      .run(project, encode(text), Date.now())
  } catch {}
}

export function clearDraft(projectKey?: string): void {
  const project = projectKey ?? projectKeyFor()
  try {
    getDb().prepare('DELETE FROM draft WHERE project = ?').run(project)
  } catch {}
}

export function clearPromptHistory(): { history: number; drafts: number } {
  try {
    const database = getDb()
    const h = database.prepare('DELETE FROM history').run()
    const d = database.prepare('DELETE FROM draft').run()
    try {
      database.exec('VACUUM;')
    } catch {}
    try {
      rmSync(legacyHistoryPath(), { force: true })
    } catch {}
    try {
      rmSync(join(options.app.systemDir, 'prompt-draft.b64'), { force: true })
    } catch {}
    return { history: Number(h.changes ?? 0), drafts: Number(d.changes ?? 0) }
  } catch {
    return { history: 0, drafts: 0 }
  }
}
