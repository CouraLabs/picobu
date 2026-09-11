import { mkdirSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { options } from '@config/options.ts'
import { withLock } from '@shared/lock.ts'
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

export class CheckpointStore {
  private records: Array<CheckpointRecord> = []
  private pointer = -1
  private loaded = false
  constructor(readonly path: string) {}

  async load(): Promise<void> {
    let content: string
    try {
      content = await readFile(this.path, 'utf8')
    } catch {
      this.records = []
      this.pointer = -1
      this.loaded = true
      return
    }
    const records: Array<CheckpointRecord> = []
    for (const raw of content.split('\n')) {
      if (!raw.trim()) continue
      try {
        records.push(CheckpointRecordSchema.parse(JSON.parse(raw)))
      } catch {}
    }
    this.records = records
    this.pointer = records.length - 1
    this.loaded = true
  }

  async record(entry: Omit<CheckpointRecord, 'seq'>): Promise<void> {
    if (!this.loaded) await this.load()
    const previousLength = this.records.length
    const discardedRedo = this.pointer + 1 < previousLength
    const next = this.records.slice(0, this.pointer + 1)
    const record: CheckpointRecord = { ...entry, seq: next.length }
    next.push(record)
    this.records = next
    this.pointer = next.length - 1
    const snapshot = [...next]
    await withLock(this.path, async () => {
      mkdirSync(dirname(this.path), { recursive: true })
      if (discardedRedo) {
        await writeFile(this.path, `${snapshot.map((item) => JSON.stringify(item)).join('\n')}\n`)
      } else {
        await appendFile(this.path, `${JSON.stringify(record)}\n`)
      }
    })
  }
  get canUndo(): boolean {
    return this.pointer >= 0
  }
  get canRedo(): boolean {
    return this.pointer < this.records.length - 1
  }

  async undo(): Promise<UndoResult> {
    if (!this.loaded) await this.load()
    if (!this.canUndo) return { applied: 0, paths: [] }
    const record = this.records[this.pointer]
    if (!record) return { applied: 0, paths: [] }
    this.pointer -= 1
    await this.apply(record.path, record.before)
    return { applied: 1, paths: [record.path] }
  }

  async redo(): Promise<UndoResult> {
    if (!this.loaded) await this.load()
    if (!this.canRedo) return { applied: 0, paths: [] }
    this.pointer += 1
    const record = this.records[this.pointer]
    if (!record) return { applied: 0, paths: [] }
    await this.apply(record.path, record.after)
    return { applied: 1, paths: [record.path] }
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
