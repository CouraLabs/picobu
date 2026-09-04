import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { withLock } from "@shared/lock.ts";
import { options } from "@config/options.ts";

export const CheckpointRecordSchema = z.object({
  seq: z.number().int().min(0),
  tool: z.enum(["write", "edit"]),
  /** Absolute path at record time (checkpoints replay by absolute path). */
  path: z.string(),
  /** File content before the change; null = file did not exist (created). */
  before: z.string().nullable(),
  /** File content after the change; null = file was deleted. */
  after: z.string().nullable(),
});

export type CheckpointRecord = z.infer<typeof CheckpointRecordSchema>;

/** Per-session checkpoint log: `sessions/<folderKey>/<sessionId>/checkpoints.jsonl`. */
export const checkpointsPath = (folderKey: string, sessionId: string): string =>
  join(options.app.systemDir, "sessions", folderKey, sessionId, "checkpoints.jsonl");

export type UndoResult = { applied: number; paths: string[] };

/**
 * Append-only checkpoint log with an in-memory undo/redo pointer. Every
 * `write`/`edit` records the file's before/after content; `undo` restores the
 * `before` state of the last applied record, `redo` re-applies its `after`.
 * A new record truncates the redo tail. Shell mutations are deliberately not
 * checkpointed (documented limitation).
 */
export class CheckpointStore {
  private records: CheckpointRecord[] = [];
  /** Index of the last applied forward change (-1 = nothing applied). */
  private pointer = -1;
  private loaded = false;

  constructor(readonly path: string) {}

  /** Load the log from disk; the pointer starts at the last record (a resumed
   * session can undo but not redo past its own history). */
  async load(): Promise<void> {
    let content: string;
    try {
      content = await readFile(this.path, "utf8");
    } catch {
      this.records = [];
      this.pointer = -1;
      this.loaded = true;
      return;
    }
    const records: CheckpointRecord[] = [];
    for (const raw of content.split("\n")) {
      if (!raw.trim()) continue;
      try {
        records.push(CheckpointRecordSchema.parse(JSON.parse(raw)));
      } catch {
        // skip unparseable lines
      }
    }
    this.records = records;
    this.pointer = records.length - 1;
    this.loaded = true;
  }

  /** Append a record (truncating any redo tail first). */
  async record(entry: Omit<CheckpointRecord, "seq">): Promise<void> {
    if (!this.loaded) await this.load();
    const next = this.records.slice(0, this.pointer + 1);
    const record: CheckpointRecord = { ...entry, seq: next.length };
    next.push(record);
    this.records = next;
    this.pointer = next.length - 1;
    await withLock(this.path, async () => {
      mkdirSync(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(record)}\n`);
    });
  }

  get canUndo(): boolean {
    return this.pointer >= 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.records.length - 1;
  }

  /** Undo the last applied change: restore the record's `before` state. */
  async undo(): Promise<UndoResult> {
    if (!this.loaded) await this.load();
    if (!this.canUndo) return { applied: 0, paths: [] };
    const record = this.records[this.pointer]!;
    this.pointer -= 1;
    await this.apply(record.path, record.before);
    return { applied: 1, paths: [record.path] };
  }

  /** Redo the next change: re-apply the record's `after` state. */
  async redo(): Promise<UndoResult> {
    if (!this.loaded) await this.load();
    if (!this.canRedo) return { applied: 0, paths: [] };
    this.pointer += 1;
    const record = this.records[this.pointer]!;
    await this.apply(record.path, record.after);
    return { applied: 1, paths: [record.path] };
  }

  /** Restore a file to `content` (null = the file did not exist: delete it). */
  private async apply(path: string, content: string | null): Promise<void> {
    await withLock(path, async () => {
      if (content === null) {
        await rm(path, { force: true });
        return;
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    });
  }
}
