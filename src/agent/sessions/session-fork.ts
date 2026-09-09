import { readSessionMeta, writeSessionMeta, folderKeyForSession } from "@agent/sessions/session-meta.ts";
import { generateSessionId, folderKeyFor } from "@agent/sessions/session-paths.ts";
import { loadSession, writeSessionFile } from "@agent/sessions/session-store.ts";
import { messagesForLlm } from "@agent/sessions/session-compaction.ts";
import type { Session } from "@agent/sessions/session.ts";

export type ForkDeps = {
  cwd: string;
  live: Map<string, Session>;
  startSession: (id: string) => Promise<Session>;
};

/** Messages up to and including the one with the given id; throws when absent. */
export function sliceMessagesUpTo<M extends { id: string }>(messages: M[], messageId: string): M[] {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) throw new Error(`Unknown message "${messageId}"`);
  return messages.slice(0, index + 1);
}

export async function forkSession(
  deps: ForkDeps,
  id: string,
  opts: { fromCompaction?: boolean; upToMessageId?: string } = {},
): Promise<{ sessionId: string }> {
  const { cwd, live } = deps;
  const folderKey = await folderKeyForSession(cwd, id);
  const source = live.get(id);
  if (source?.state === "running") {
    throw new Error(`Session "${id}" is running; stop it before forking`);
  }
  const meta = await readSessionMeta(folderKey, id);
  if (!source && meta?.state === "running") {
    throw new Error(`Session "${id}" is running; stop it before forking`);
  }
  await source?.flush();
  const messages = await loadSession(folderKey, id);
  if (!messages) throw new Error(`Unknown session "${id}"`);
  const forkedMessages = opts.upToMessageId
    ? sliceMessagesUpTo(messages, opts.upToMessageId)
    : opts.fromCompaction
      ? messagesForLlm(messages)
      : messages;
  const forkId = generateSessionId();
  await writeSessionFile(folderKey, forkId, forkedMessages);
  if (meta) {
    await writeSessionMeta(folderKey, forkId, {
      ...meta,
      id: forkId,
      title: meta.title ? `${meta.title} (forked)` : "(forked)",
      parentSessionId: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  if (folderKey !== folderKeyFor(cwd)) return { sessionId: forkId };
  const fork = await deps.startSession(forkId);
  return { sessionId: fork.id };
}
