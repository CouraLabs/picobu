import { mkdirSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { options } from '@config/options.ts'
import { withLock } from '@shared/lock.ts'
import { logDebug } from '@shared/logger.ts'
import { z } from 'zod'
export const CheckpointRecordSchema = z.object({
  seq: z.number().int().min(0),
  tool: z.enum(['write', 'edit']),
  path: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
})
export type CheckpointRecord = z.infer<typeof CheckpointRecordSchema>

export const checkpointsPath = (folderKey: string, sessionId: string): string => join(options.app.systemDir, 'sessions', folderKey, sessionId, 'checkpoints.jsonl')
export interface UndoResult {
  applied: number
  paths: Array<string>
}

const eachCheckpointLine = async (path: string, visit: (record: CheckpointRecord, raw: string) => boolean): Promise<void> => {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    return
  }
  let start = 0
  while (start <= content.length) {
    const newline = content.indexOf('\n', start)
    const end = newline === -1 ? content.length : newline
    const raw = content.slice(start, end)
    start = newline === -1 ? content.length + 1 : newline + 1
    if (!raw.trim()) continue
    let record: CheckpointRecord | undefined
    try {
      record = CheckpointRecordSchema.parse(JSON.parse(raw))
    } catch (error) {
      logDebug('swallowed error', { scope: 'checkpoints', error })
    }
    if (!record) continue
    if (visit(record, raw)) return
  }
}

const countCheckpointLines = async (path: string): Promise<number> => {
  let count = 0
  await eachCheckpointLine(path, () => {
    count += 1
    return false
  })
  return count
}

export class CheckpointStore {
  private recordCount = 0
  private pointer = -1
  private loaded = false
  constructor(readonly path: string) {}

  async load(): Promise<void> {
    this.recordCount = await countCheckpointLines(this.path)
    this.pointer = this.recordCount - 1
    this.loaded = true
  }

  async record(entry: Omit<CheckpointRecord, 'seq'>): Promise<void> {
    if (!this.loaded) await this.load()
    const keepCount = this.pointer + 1
    const discardedRedo = keepCount < this.recordCount
    const seq = keepCount
    const line = JSON.stringify({ ...entry, seq })
    this.recordCount = keepCount + 1
    this.pointer = keepCount
    await withLock(this.path, async () => {
      mkdirSync(dirname(this.path), { recursive: true })
      if (discardedRedo) {
        const kept: Array<string> = []
        await eachCheckpointLine(this.path, (_record, raw) => {
          if (kept.length >= keepCount) return true
          kept.push(raw)
          return kept.length >= keepCount
        })
        await writeFile(this.path, `${[...kept, line].join('\n')}\n`)
      } else {
        await appendFile(this.path, `${line}\n`)
      }
    })
  }
  get canUndo(): boolean {
    return this.pointer >= 0
  }
  get canRedo(): boolean {
    return this.pointer < this.recordCount - 1
  }

  async undo(): Promise<UndoResult> {
    if (!this.loaded) await this.load()
    if (!this.canUndo) return { applied: 0, paths: [] }
    const index = this.pointer
    if (index < 0) return { applied: 0, paths: [] }
    const record = await this.readRecordAt(index)
    if (!record) return { applied: 0, paths: [] }
    this.pointer -= 1
    await this.apply(record.path, record.before)
    return { applied: 1, paths: [record.path] }
  }

  async redo(): Promise<UndoResult> {
    if (!this.loaded) await this.load()
    if (!this.canRedo) return { applied: 0, paths: [] }
    const index = this.pointer + 1
    if (index >= this.recordCount) return { applied: 0, paths: [] }
    const record = await this.readRecordAt(index)
    if (!record) return { applied: 0, paths: [] }
    this.pointer += 1
    await this.apply(record.path, record.after)
    return { applied: 1, paths: [record.path] }
  }

  private async readRecordAt(index: number): Promise<CheckpointRecord | undefined> {
    let found: CheckpointRecord | undefined
    let seen = 0
    await eachCheckpointLine(this.path, (record) => {
      if (seen === index) {
        found = record
        return true
      }
      seen += 1
      return false
    })
    return found
  }

  private async apply(path: string, content: string | null): Promise<void> {
    await withLock(path, async () => {
      if (content === null) {
        await rm(path, { force: true })
        return
      }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    })
  }
}
