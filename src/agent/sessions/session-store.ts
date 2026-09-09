import { mkdirSync } from "node:fs";
import { appendFile, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { COMPACTION_HEADER } from "@agent/sessions/session-compaction.ts";
import { sanitizeMessages } from "@agent/sessions/session-messages.ts";
import { sessionDir, sessionFilePath } from "@agent/sessions/session-paths.ts";
import { withLock } from "@shared/lock.ts";
import { truncate } from "@shared/text-stats.ts";
import type { UIMessage } from "ai";
import { z } from "zod";

function isTombstone(value: unknown): value is { id: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("tombstone" in value) || value.tombstone !== true) return false;
  return "id" in value && typeof value.id === "string";
}
const sessionLineSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.unknown()),
});
type SessionLine = z.infer<typeof sessionLineSchema>;

const isStreamingMessage = (message: UIMessage): boolean => message.parts.some((part) => (part as { state?: string }).state === "streaming");

export async function loadSession(folderKey: string, sessionId: string): Promise<UIMessage[] | null> {
  const filePath = sessionFilePath(folderKey, sessionId);
  let content: string;
  try {
    content = await withLock(filePath, () => readFile(filePath, "utf8"));
  } catch {
    return null;
  }
  const byId = new Map<string, { line: SessionLine; index: number }>();
  for (const [index, raw] of content.split("\n").entries()) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue;
    }
    if (isTombstone(value)) {
      byId.delete(value.id);
      continue;
    }
    let parsed: SessionLine;
    try {
      parsed = sessionLineSchema.parse(value);
    } catch {
      continue;
    }
    const existing = byId.get(parsed.id);
    if (existing) existing.line = parsed;
    else byId.set(parsed.id, { line: parsed, index });
  }
  const ordered = [...byId.values()].sort((a, b) => a.index - b.index).map((e) => e.line as unknown as UIMessage);
  return sanitizeMessages(ordered);
}

const previewLineSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.unknown()).optional(),
});
function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || part.type !== "text") return false;
  if (!("text" in part) || typeof part.text !== "string") return false;
  return true;
}

function firstPromptPreview(content: string): string {
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let line: z.infer<typeof previewLineSchema>;
    try {
      line = previewLineSchema.parse(JSON.parse(raw));
    } catch {
      continue;
    }
    if (line.role !== "user") continue;
    const meta = line.metadata as { compaction?: unknown } | undefined;
    if (meta?.compaction) continue;
    const text = (line.parts ?? []).find(isTextPart)?.text.trim();
    if (!text) continue;
    if (text.startsWith(COMPACTION_HEADER)) continue;
    return truncate(text);
  }
  return "(no text)";
}

export type SessionRow = { id: string; mtimeMs: number; firstPrompt: string };

export async function writeSessionFile(folderKey: string, sessionId: string, messages: UIMessage[]): Promise<void> {
  const filePath = sessionFilePath(folderKey, sessionId);
  await withLock(filePath, async () => {
    mkdirSync(dirname(filePath), { recursive: true });
    await writeFile(filePath, messages.map((m) => JSON.stringify({ id: m.id, role: m.role, metadata: m.metadata, parts: m.parts })).join("\n") + "\n");
  });
}

export async function listSessions(folderKey: string): Promise<SessionRow[]> {
  let names: string[];
  try {
    names = await readdir(sessionDir(folderKey));
  } catch {
    return [];
  }
  const rows: SessionRow[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const filePath = join(sessionDir(folderKey), name);
    try {
      const [info, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
      rows.push({ id, mtimeMs: info.mtimeMs, firstPrompt: firstPromptPreview(content) });
    } catch {}
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export class SessionSaver {
  private lastWritten = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;
  constructor(private readonly filePath: string) {}
  save(messages: UIMessage[]): Promise<void> {
    if (!this.initialized) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.initialized = true;
    }
    const tasks: Promise<void>[] = [];
    const enqueue = (operation: () => Promise<void>): void => {
      const task = this.queue.then(operation);
      this.queue = task.catch(() => {});
      tasks.push(task);
    };
    const currentIds = new Set(messages.map((m) => m.id));
    for (const id of [...this.lastWritten.keys()]) {
      if (currentIds.has(id)) continue;
      this.lastWritten.delete(id);
      const line = JSON.stringify({ id, tombstone: true });
      enqueue(() => withLock(this.filePath, () => appendFile(this.filePath, line + "\n")));
    }
    for (const m of messages) {
      if (isStreamingMessage(m)) continue;
      const json = JSON.stringify({ id: m.id, role: m.role, metadata: m.metadata, parts: m.parts });
      if (this.lastWritten.get(m.id) === json) continue;
      enqueue(async () => {
        await withLock(this.filePath, () => upsertLine(this.filePath, json));
        this.lastWritten.set(m.id, json);
      });
    }
    return Promise.all(tasks).then(() => {});
  }
  flush(): Promise<void> {
    return this.queue;
  }
}

const lineId = (raw: string): string | undefined => {
  try {
    return (JSON.parse(raw) as { id?: unknown }).id as string | undefined;
  } catch {
    return undefined;
  }
};

async function upsertLine(filePath: string, json: string): Promise<void> {
  const id = lineId(json);
  let content = "";
  try {
    content = await readFile(filePath, "utf8");
  } catch {}
  const lines = content.split("\n").filter((raw) => raw.trim());
  const existing = lines.map(lineId).lastIndexOf(id);
  if (existing === -1) {
    lines.push(json);
  } else {
    lines[existing] = json;
  }
  mkdirSync(dirname(filePath), { recursive: true });
  await writeFile(filePath, lines.join("\n") + "\n");
}
