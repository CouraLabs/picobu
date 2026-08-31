import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { UIMessage, UIMessagePart } from "ai";
import { z } from "zod";
import { options } from "./options";
import { withLock } from "./lock";

/** Folder key: sanitized basename of the cwd. Empty/degenerate input -> "default". */
export function folderKeyFor(cwd: string): string {
  const raw = basename(cwd).toLowerCase();
  const key = raw.replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return key || "default";
}

/** 16-hex session id (first 16 chars of a sha1 over cwd/time/uuid). */
export function generateSessionId(): string {
  return createHash("sha1")
    .update(`${process.cwd()}|${Date.now()}|${randomUUID()}`)
    .digest("hex")
    .slice(0, 16);
}

export const sessionsRoot = (): string => join(options.app.systemDir, "sessions");
export const sessionDir = (folderKey: string): string => join(sessionsRoot(), folderKey);
export const sessionFilePath = (folderKey: string, sessionId: string): string =>
  join(sessionDir(folderKey), `${sessionId}.jsonl`);
/** Per-session todo file (flow `todo` tool): `<folder>/<sessionId>/session-todo.json`. */
export const sessionTodoFilePath = (folderKey: string, sessionId: string): string =>
  join(sessionDir(folderKey), sessionId, "session-todo.json");
/** The `persitent` spelling is intentional (spec). */
export const persistentRoot = (): string => join(sessionsRoot(), "persitent");
export const persistentTurnFilePath = (timestamp: number, turn: number): string =>
  join(persistentRoot(), `${timestamp}-${turn}.jsonl`);

/** Tool-part states that are safe to re-send to the provider (mirrors AI SDK's
 * `ignoreIncompleteToolCalls` filter). Everything else — a dangling `call`,
 * `approval-requested`, ... — is stripped so an interrupted run can resume. */
const KEEP_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
  "approval-responded",
]);

export function sanitizeMessages<M extends UIMessage>(messages: M[]): M[] {
  return messages.flatMap((m) => {
    // Drop dangling tool parts (a `call`/`approval-requested` without a result)
    // so an interrupted run can be re-sent to the provider and re-rendered.
    // AI SDK tool parts are `tool-<name>` (typed tools) or `dynamic-tool`.
    const parts = m.parts.filter((part) => {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return true;
      return "state" in part && KEEP_TOOL_STATES.has(part.state ?? "");
    });
    return parts.length ? [{ ...m, parts }] : [];
  });
}

/**
 * True when an assistant message carries user-visible response content: a
 * non-empty answer text or a completed tool call. Streaming-only reasoning
 * does not count — interrupting during the thinking phase leaves nothing
 * worth keeping, so the whole turn can be erased.
 */
export function hasVisibleResponse(m: UIMessage): boolean {
  return m.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      return "state" in part && KEEP_TOOL_STATES.has(part.state ?? "");
    }
    return false;
  });
}

/**
 * Drop a prompt that never received a response: an interrupt before the
 * assistant produced an answer (or before its message even appeared) removes
 * the trailing assistant stub and the user prompt that triggered it, so the
 * erased turn leaves nothing behind.
 */
export function dropUnansweredPrompt<M extends UIMessage>(messages: M[]): M[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  if (last.role === "assistant" && !hasVisibleResponse(last)) {
    const prev = messages[messages.length - 2];
    if (prev?.role === "user") return messages.slice(0, -2);
    return messages.slice(0, -1);
  }
  // A trailing prompt whose assistant message was never created (cancelled
  // between submit and the first streamed chunk) is unanswered too.
  if (last.role === "user") return messages.slice(0, -1);
  return messages;
}

/** Tombstone line appended by `SessionSaver` when a previously written message
 * is removed from the in-memory conversation (e.g. an interrupted prompt with
 * no response). Append-only files can't delete, so the loader drops these. */
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

/**
 * Load a session file, dedupe by message id (last occurrence's content at the
 * first occurrence's position — appends are idempotent so latest wins), then
 * sanitize. Returns null when the file is missing.
 */
export async function loadSession(
  folderKey: string,
  sessionId: string,
): Promise<UIMessage[] | null> {
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
      continue; // skip unparseable lines
    }
    // A tombstone erases a previously written message (removed mid-run, e.g.
    // an interrupted prompt with no response).
    if (isTombstone(value)) {
      byId.delete(value.id);
      continue;
    }
    let parsed: SessionLine;
    try {
      parsed = sessionLineSchema.parse(value);
    } catch {
      continue; // skip unparseable lines
    }
    const existing = byId.get(parsed.id);
    if (existing) existing.line = parsed; // keep first position, latest content
    else byId.set(parsed.id, { line: parsed, index });
  }

  const ordered = [...byId.values()]
    .sort((a, b) => a.index - b.index)
    // The parts union is too wide to re-validate per part; the renderer's
    // exhaustive switch is the safety net (see plan).
    .map((e) => e.line as unknown as UIMessage);
  return sanitizeMessages(ordered);
}

const previewLineSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.unknown()).optional(),
});

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || part.type !== "text") return false;
  if (!("text" in part) || typeof part.text !== "string") return false;
  return true;
}

/** First user text preview for a session file, truncated to 60 chars. */
function firstPromptPreview(content: string): string {
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let line: z.infer<typeof previewLineSchema>;
    try {
      line = previewLineSchema.parse(JSON.parse(raw));
    } catch {
      continue; // skip unparseable lines
    }
    if (line.role !== "user") continue;
    const text = (line.parts ?? []).find(isTextPart)?.text.trim();
    if (text) return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }
  return "(no text)";
}

export type SessionRow = { id: string; mtimeMs: number; firstPrompt: string };

/** List saved sessions for a folder, newest first. Best-effort: unreadable or
 * malformed files are skipped, a missing dir yields []. */
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
    } catch {
      // skip unreadable files
    }
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Incremental JSONL session writer. `save` appends the latest serialized form
 * of each changed message under the file lock (idempotent for unchanged ones);
 * dedupe-on-load makes the appended duplicate versions safe. Writes are
 * serialized through an internal promise chain; `flush` awaits it (used on
 * unmount and by tests).
 */
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
    const currentIds = new Set(messages.map((m) => m.id));
    // Messages written before but gone now (interrupted prompt with no
    // response) are tombstoned so the loader drops them on resume.
    for (const id of [...this.lastWritten.keys()]) {
      if (currentIds.has(id)) continue;
      this.lastWritten.delete(id);
      const line = JSON.stringify({ id, tombstone: true });
      this.queue = this.queue.then(() =>
        withLock(this.filePath, () => appendFile(this.filePath, line + "\n")),
      );
    }
    for (const m of messages) {
      const json = JSON.stringify({ id: m.id, role: m.role, metadata: m.metadata, parts: m.parts });
      if (this.lastWritten.get(m.id) === json) continue;
      this.lastWritten.set(m.id, json);
      this.queue = this.queue.then(() =>
        withLock(this.filePath, () => appendFile(this.filePath, json + "\n")),
      );
    }
    return this.queue;
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
