import { createHash, randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { options } from "@config/options.ts";

export function folderKeyFor(cwd: string): string {
  const raw = basename(cwd).toLowerCase();
  const key = raw.replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return key || "default";
}
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
export const sessionTodoFilePath = (folderKey: string, sessionId: string): string =>
  join(sessionDir(folderKey), sessionId, "session-todo.json");
export const persistentRoot = (): string => join(sessionsRoot(), "persitent");
export const persistentTurnFilePath = (timestamp: number, turn: number): string =>
  join(persistentRoot(), `${timestamp}-${turn}.jsonl`);
