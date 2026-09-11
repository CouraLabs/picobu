import type { SessionState } from '@agent/sessions/session-meta.ts'

export interface JobRow {
  sessionId: string
  parentId: string
  subagent: string
  state: SessionState
  queued: boolean
  startedAt: number
}

export class JobTracker {
  private readonly rows = new Map<string, JobRow>()
  private readonly listeners = new Set<(rows: Array<JobRow>) => void>()
  private readonly slotQueue: Array<() => void> = []
  private active = 0

  get(sessionId: string): JobRow | undefined {
    return this.rows.get(sessionId)
  }
  set(row: JobRow): void {
    this.rows.set(row.sessionId, row)
    this.emit()
  }
  patch(sessionId: string, patch: Partial<JobRow>): void {
    const row = this.rows.get(sessionId)
    if (!row) return
    this.rows.set(sessionId, { ...row, ...patch })
    this.emit()
  }
  delete(sessionId: string): void {
    this.rows.delete(sessionId)
    this.emit()
  }

  all(): Array<JobRow> {
    return [...this.rows.values()]
  }

  onJobs(listener: (rows: Array<JobRow>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(): void {
    const rows = this.all()
    for (const listener of this.listeners) listener(rows)
  }

  get activeSlots(): number {
    return this.active
  }

  async acquireSlot(maxAgents: number): Promise<void> {
    if (this.active < maxAgents) {
      this.active += 1
      return
    }
    await new Promise<void>((release) => this.slotQueue.push(release))
    this.active += 1
  }
  releaseSlot(): void {
    if (this.active > 0) this.active -= 1
    this.slotQueue.shift()?.()
  }
}
