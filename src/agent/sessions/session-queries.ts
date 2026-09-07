import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { options } from "@config/options.ts";
import type { Session } from "@agent/sessions/session.ts";
import { folderKeyFor, sessionFilePath } from "@agent/sessions/session-paths.ts";
import { listSessions } from "@agent/sessions/session-store.ts";
import {
  deleteSessionMeta,
  readSessionMeta,
  folderKeyForSession,
  type SessionMeta,
  type SessionState,
} from "@agent/sessions/session-meta.ts";
import type { JobTracker } from "@agent/sessions/session-jobs.ts";

export type SessionListRow = {
  id: string;
  mtimeMs: number;
  firstPrompt: string;
  title?: string;
  state: SessionState;
  parentSessionId?: string;
  cwd?: string;
};

export type QueryDeps = {
  cwd: string;
  live: Map<string, Session>;
  jobs: JobTracker;
};

export async function listSessionsFor(deps: QueryDeps): Promise<SessionListRow[]> {
  const { cwd } = deps;
  const folderKey = folderKeyFor(cwd);
  const rows = await listSessions(folderKey);
  const out: SessionListRow[] = [];
  for (const row of rows) {
    const meta = await readSessionMeta(folderKey, row.id);
    if (meta && meta.cwd !== cwd) continue;
    out.push({
      ...row,
      title: meta?.title,
      state: meta?.state ?? "finished",
      parentSessionId: meta?.parentSessionId,
      cwd: meta?.cwd,
    });
  }
  return out;
}

export async function listSessionTree(cwd: string): Promise<Array<SessionMeta & { children: SessionMeta[] }>> {
  const folderKey = folderKeyFor(cwd);
  const metas = await readAllMetas(folderKey, cwd);
  const childrenOf = (parentId: string): SessionMeta[] =>
    metas.filter((m) => m.parentSessionId === parentId);
  return metas
    .filter((m) => !m.parentSessionId)
    .map((root) => ({ ...root, children: childrenOf(root.id) }));
}

export async function deleteSessionCascade(deps: QueryDeps, id: string): Promise<number> {
  const { cwd, live, jobs } = deps;
  const folderKey = await folderKeyForSession(cwd, id);
  const subtree = await collectSubtree(folderKey, cwd, id);
  for (const nodeId of subtree) {
    const running = live.get(nodeId)?.state === "running"
      || (!live.has(nodeId) && (await readSessionMeta(folderKey, nodeId))?.state === "running");
    if (running) throw new Error(`Session "${nodeId}" is running; stop it before deleting`);
  }
  for (const nodeId of subtree) {
    live.get(nodeId)?.abort();
    live.delete(nodeId);
    jobs.delete(nodeId);
    await rm(sessionFilePath(folderKey, nodeId), { force: true });
    await deleteSessionMeta(folderKey, nodeId);
    await rm(join(options.app.systemDir, "sessions", folderKey, nodeId), { recursive: true, force: true }).catch(() => {});
  }
  return subtree.length;
}

async function collectSubtree(folderKey: string, cwd: string, rootId: string): Promise<string[]> {
  const byParent = new Map<string, string[]>();
  for (const meta of await readAllMetas(folderKey, cwd)) {
    if (!meta.parentSessionId) continue;
    const list = byParent.get(meta.parentSessionId) ?? [];
    list.push(meta.id);
    byParent.set(meta.parentSessionId, list);
  }
  const out = [rootId];
  const queue = [rootId];
  while (queue.length) {
    for (const childId of byParent.get(queue.shift()!) ?? []) {
      out.push(childId);
      queue.push(childId);
    }
  }
  return out;
}

async function readAllMetas(folderKey: string, cwd: string): Promise<SessionMeta[]> {
  let names: string[];
  try {
    names = (await readdir(join(options.app.systemDir, "sessions", folderKey)))
      .filter((n) => n.endsWith(".meta.json"))
      .map((n) => n.slice(0, -".meta.json".length));
  } catch {
    return [];
  }
  const metas = await Promise.all(names.map((id) => readSessionMeta(folderKey, id)));
  return metas.filter((m): m is SessionMeta => m !== null && m.cwd === cwd);
}
