import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { options } from "@libs/options.ts";
import { withLock } from "@libs/lock.ts";

/** Max prompts kept in the rolling history. */
export const PROMPT_HISTORY_LIMIT = 10;

const promptHistorySchema = z.object({ prompts: z.array(z.string()) });

export type PromptHistoryFile = z.infer<typeof promptHistorySchema>;

/** Path of the persisted prompt history: `<systemDir>/prompt-history.json`. */
export const promptHistoryPath = (): string => join(options.app.systemDir, "prompt-history.json");

let cache: string[] | null = null;

function readFromDisk(): string[] {
  try {
    const parsed = promptHistorySchema.parse(JSON.parse(readFileSync(promptHistoryPath(), "utf8")));
    return parsed.prompts.filter((p) => p.trim().length > 0).slice(-PROMPT_HISTORY_LIMIT);
  } catch {
    return []; // missing or malformed history starts empty
  }
}

/** Drop the in-memory cache so the next read re-loads from disk (test seam). */
export function resetPromptHistoryCache(): void {
  cache = null;
}

/** The persisted history, seeded from disk on first use (mirrors `options.ts`). */
export function loadPromptHistory(): string[] {
  cache ??= readFromDisk();
  return [...cache];
}

let writeQueue: Promise<void> = Promise.resolve();

/** Await any pending history write (tests). */
export function flushPromptHistory(): Promise<void> {
  return writeQueue;
}

async function persist(prompts: string[]): Promise<void> {
  mkdirSync(options.app.systemDir, { recursive: true });
  const payload = JSON.stringify({ prompts } satisfies PromptHistoryFile, null, 2);
  await withLock(promptHistoryPath(), () => writeFile(promptHistoryPath(), `${payload}\n`, "utf8"));
}

/**
 * Record a submitted prompt: trimmed, deduped (a re-submitted prompt moves to
 * the end — most recent last), capped at `PROMPT_HISTORY_LIMIT`, persisted
 * fire-and-forget under the file lock. `current` (the caller's in-memory
 * history) wins over a disk re-read when provided.
 */
export function addPrompt(text: string, current?: string[]): string[] {
  const base = current ?? loadPromptHistory();
  const trimmed = text.trim();
  if (!trimmed) return base;
  const next = base.filter((p) => p !== trimmed);
  next.push(trimmed);
  while (next.length > PROMPT_HISTORY_LIMIT) next.shift();
  cache = [...next];
  writeQueue = writeQueue.then(() => persist(next)).catch(() => {}); // best-effort
  return [...next];
}
