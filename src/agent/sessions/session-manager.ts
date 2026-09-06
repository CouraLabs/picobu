import { readdir, rm, stat, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { withLock } from "@shared/lock.ts";
import {
  options,
  resolveModelRole,
  type ProviderModelReasoningEffort,
} from "@config/options.ts";
import { resolveModelRef } from "@agent/model/resolver.ts";
import {
  createSession,
  folderKeyFor,
  generateSessionId,
  listSessions,
  loadSession,
  messagesForLlm,
  sessionFilePath,
  toPromptMessage,
  type Session,
  type SessionPrompt,
} from "@agent/sessions/session.ts";
import {
  deleteSessionMeta,
  readSessionMeta,
  recoverSessionMeta,
  updateSessionMeta,
  writeSessionMeta,
  type SessionMeta,
  type SessionState,
} from "@agent/sessions/session-meta.ts";
import {
  getSubagent,
  listSubagents,
  prepareSubagent,
  SUBAGENT_DEPTH_CAP,
} from "@agent/agents/subagents.ts";
import type { LoopConfig } from "@agent/loop/create-loop.ts";
import type { AgentType } from "@agent/agents/types.ts";
import type { UIMessage } from "ai";


export type JobRow = {
  sessionId: string;
  parentId: string;
  subagent: string;
  state: SessionState;
  queued: boolean;
  startedAt: number;
};
export type SpawnSubSessionParams = {
  parentId: string;
  subagent: string;
  prompt: SessionPrompt;
  depth: number;
};
export type CreateSessionOptions = {
  id?: string;
  agentId?: string;
  modelKey?: string;
  title?: string;
  autoCompact?: boolean;
  forkOnCompact?: boolean;
};
const DEFAULT_MAX_AGENTS = 4;


export class SessionManager {
  private cwd: string;
  private _sandboxEnabled = true;
  private readonly _maxAgents: number;
  private readonly live = new Map<string, Session>();
  private readonly jobRows = new Map<string, JobRow>();
  private readonly jobListeners = new Set<(rows: JobRow[]) => void>();
  private readonly slotQueue: Array<() => void> = [];
  private activeSlots = 0;
  constructor(init: { cwd?: string; maxAgents?: number } = {}) {
    this.cwd = resolve(init.cwd ?? options.app.cwd);
    this._maxAgents = init.maxAgents ?? options.harness.maxAgents ?? DEFAULT_MAX_AGENTS;
  }

  
  get currentCwd(): string {
    return this.cwd;
  }

  
  get maxAgents(): number {
    return this._maxAgents;
  }

  
  
  

  
  setSandbox(enabled: boolean): void {
    this._sandboxEnabled = enabled;
  }
  get sandboxEnabled(): boolean {
    return this._sandboxEnabled;
  }

  
  private baseConfig(overrides: { agentId?: string; modelKey?: string; sessionId?: string; agentOverride?: AgentType; subagent?: boolean; spawn?: LoopConfig["spawn"] } = {}): LoopConfig {
    let modelKey = overrides.modelKey;
    let thinking: ProviderModelReasoningEffort | undefined;
    if (!modelKey) {
      try {
        const role = resolveModelRole(options.harness, "flash");
        modelKey = role.modelKey;
        thinking = role.thinking;
      } catch {
        
        
        modelKey = "unconfigured/none";
        thinking = "medium";
      }
    }
    return {
      agentId: overrides.agentId ?? "coder",
      modelKey,
      thinking: thinking ?? "medium",
      cwd: this.cwd,
      sandbox: this._sandboxEnabled,
      sessionId: overrides.sessionId,
      ...(overrides.agentOverride ? { agentOverride: overrides.agentOverride } : {}),
      ...(overrides.subagent ? { subagent: true } : {}),
      ...(overrides.spawn ? { spawn: overrides.spawn } : {}),
    };
  }

  
  
  

  
  async startSession(init: CreateSessionOptions = {}): Promise<Session> {
    const id = init.id ?? generateSessionId();
    const folderKey = folderKeyFor(this.cwd);

    
    if (!this.live.has(id)) await recoverSessionMeta(folderKey, id);
    const session = await createSession(() => this.baseConfig({ agentId: init.agentId, modelKey: init.modelKey, sessionId: id }), {
      id,
      meta: { cwd: this.cwd, title: init.title, forkHost: () => this.forkSession(id).then((r) => r.sessionId) },
      autoCompact: init.autoCompact,
      forkOnCompact: init.forkOnCompact,
    });
    this.live.set(id, session);
    return session;
  }

  
  getSession(id: string): Session | undefined {
    return this.live.get(id);
  }

  
  async loadMessages(id: string): Promise<UIMessage[] | null> {
    const folderKey = await this.folderKeyForSession(id);
    return loadSession(folderKey, id);
  }

  
  private async folderKeyForSession(id: string): Promise<string> {
    const meta = await readSessionMeta(folderKeyFor(this.cwd), id);
    return folderKeyFor(meta?.cwd ?? this.cwd);
  }

  
  async changeDirectory(path: string): Promise<Session | undefined> {
    const next = resolve(path);
    const info = await stat(next).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`Not a directory: ${next}`);
    if (next === this.cwd) return undefined; 
    this.cwd = next;
    return this.startSession();
  }

  
  async renameSession(id: string, title: string): Promise<void> {
    return this.setSessionTitle(id, title);
  }
  async setSessionTitle(id: string, title: string): Promise<void> {
    const folderKey = await this.folderKeyForSession(id);
    const updated = await updateSessionMeta(folderKey, id, { title });
    if (!updated) {
      const meta = await readSessionMeta(folderKey, id);
      if (meta) await writeSessionMeta(folderKey, id, { ...meta, title });
      else throw new Error(`Unknown session "${id}"`);
    }
  }

  
  async forkSession(id: string, opts: { fromCompaction?: boolean } = {}): Promise<{ sessionId: string }> {
    const folderKey = await this.folderKeyForSession(id);
    
    
    const source = this.live.get(id);
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
    const forkedMessages = opts.fromCompaction ? messagesForLlm(messages) : messages;
    const forkId = generateSessionId();
    const filePath = sessionFilePath(folderKey, forkId);
    await withLock(filePath, async () => {
      mkdirSync(dirname(filePath), { recursive: true });
      await writeFile(
        filePath,
        forkedMessages
          .map((m) => JSON.stringify({ id: m.id, role: m.role, metadata: m.metadata, parts: m.parts }))
          .join("\n") + "\n",
      );
    });
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
    
    
    
    
    
    if (folderKey !== folderKeyFor(this.cwd)) return { sessionId: forkId };
    const fork = await this.startSession({ id: forkId });
    return { sessionId: fork.id };
  }

  
  
  

  
  async listSessions(): Promise<Array<{
    id: string;
    mtimeMs: number;
    firstPrompt: string;
    title?: string;
    state: SessionState;
    parentSessionId?: string;
    cwd?: string;
  }>> {
    const folderKey = folderKeyFor(this.cwd);
    const rows = await listSessions(folderKey);
    const out: Array<{
      id: string;
      mtimeMs: number;
      firstPrompt: string;
      title?: string;
      state: SessionState;
      parentSessionId?: string;
      cwd?: string;
    }> = [];
    for (const row of rows) {
      const meta = await readSessionMeta(folderKey, row.id);
      
      
      if (meta && meta.cwd !== this.cwd) continue;
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

  
  async listSessionTree(): Promise<Array<SessionMeta & { children: SessionMeta[] }>> {
    const folderKey = folderKeyFor(this.cwd);
    const metas = await this.readAllMetas(folderKey);
    const childrenOf = (parentId: string): SessionMeta[] =>
      metas.filter((m) => m.parentSessionId === parentId);
    return metas
      .filter((m) => !m.parentSessionId)
      .map((root) => ({ ...root, children: childrenOf(root.id) }));
  }

  
  private async readAllMetas(folderKey: string): Promise<SessionMeta[]> {
    let names: string[];
    try {
      names = (await readdir(join(options.app.systemDir, "sessions", folderKey)))
        .filter((n) => n.endsWith(".meta.json"))
        .map((n) => n.slice(0, -".meta.json".length));
    } catch {
      return [];
    }
    const metas = await Promise.all(names.map((id) => readSessionMeta(folderKey, id)));
    return metas.filter((m): m is SessionMeta => m !== null && m.cwd === this.cwd);
  }

  
  
  

  
  async deleteSession(id: string): Promise<number> {
    const folderKey = await this.folderKeyForSession(id);
    const subtree = await this.collectSubtree(folderKey, id);
    
    
    for (const nodeId of subtree) {
      const running = this.live.get(nodeId)?.state === "running"
        || (this.live.has(nodeId) === false && (await readSessionMeta(folderKey, nodeId))?.state === "running");
      if (running) throw new Error(`Session "${nodeId}" is running; stop it before deleting`);
    }
    for (const nodeId of subtree) {
      this.live.get(nodeId)?.abort();
      this.live.delete(nodeId);
      this.jobRows.delete(nodeId);
      this.emitJobs();
      await rm(sessionFilePath(folderKey, nodeId), { force: true });
      await deleteSessionMeta(folderKey, nodeId);
      await rm(join(options.app.systemDir, "sessions", folderKey, nodeId), { recursive: true, force: true }).catch(() => {});
    }
    return subtree.length;
  }

  
  private async collectSubtree(folderKey: string, rootId: string): Promise<string[]> {
    const byParent = new Map<string, string[]>();
    for (const meta of await this.readAllMetas(folderKey)) {
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

  
  
  

  
  jobs(): JobRow[] {
    return [...this.jobRows.values()];
  }

  
  onJobs(listener: (rows: JobRow[]) => void): () => void {
    this.jobListeners.add(listener);
    return () => this.jobListeners.delete(listener);
  }
  private emitJobs(): void {
    const rows = this.jobs();
    for (const listener of this.jobListeners) listener(rows);
  }

  
  abortJob(sessionId: string): void {
    this.live.get(sessionId)?.abort();
  }

  
  abortAll(): void {
    for (const session of this.live.values()) session.abort();
  }

  
  
  

  
  async spawnSubSession({ parentId, subagent, prompt, depth }: SpawnSubSessionParams): Promise<{
    summary: string;
    usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost?: number };
  }> {
    if (this.maxAgents <= 0) throw new Error("Spawning is disabled (maxAgents is 0)");
    if (depth >= SUBAGENT_DEPTH_CAP) {
      throw new Error(`Sub agent depth cap of ${SUBAGENT_DEPTH_CAP} reached; report your findings instead of spawning deeper`);
    }
    const def = await getSubagent(subagent, this.cwd);
    if (!def) {
      const known = (await listSubagents(this.cwd)).map((s) => s.name).join(", ");
      throw new Error(`Unknown subagent "${subagent}". Known subagents: ${known}`);
    }
    const parent = this.live.get(parentId);

    
    
    const nested = depth > 0;
    if (nested && this.activeSlots >= this.maxAgents) {
      throw new Error("Agent concurrency limit reached — wait for the current sub agents to finish, then retry");
    }
    const sessionId = generateSessionId();
    this.jobRows.set(sessionId, {
      sessionId,
      parentId,
      subagent,
      state: "running",
      queued: !nested,
      startedAt: Date.now(),
    });
    this.emitJobs();
    try {
      if (!nested) await this.acquireSlot();
      this.jobRows.set(sessionId, { ...this.jobRows.get(sessionId)!, queued: false });
      this.emitJobs();
      const prepared = prepareSubagent(def);
      
      
      let modelKey = parent?.config.modelKey ?? this.baseConfig().modelKey;
      if (def.model) {
        const ref = resolveModelRef(def.model);
        if (`${ref.provider.id}/${ref.modelId}` === def.model) modelKey = def.model;
      }
      const child = await createSession(
        () => this.baseConfig({ modelKey, sessionId, agentOverride: prepared, subagent: true, spawn: { manager: this, parentId: sessionId, depth: depth + 1 } }),
        { id: sessionId, meta: { cwd: this.cwd, parentSessionId: parentId, title: `${subagent}: sub session` } },
      );
      this.live.set(sessionId, child);
      try {
        await child.sendMessage(toPromptMessage(prompt));
        
        
        if (child.error) throw child.error;
        
        
        const result = await child.summarize().catch(() => undefined);
        const summary = result?.summary ?? lastAssistantText(child.messages) ?? "(sub agent produced no output)";
        const childTotals = child.totals;
        parent?.addUsage({
          source: "subagent",
          sessionId,
          subagent,
          modelKey,
          inputTokens: childTotals.inputTokens,
          outputTokens: childTotals.outputTokens,
          cacheReadTokens: childTotals.cacheReadTokens,
          cacheWriteTokens: childTotals.cacheWriteTokens,
          cost: childTotals.cost,
        });
        this.jobRows.set(sessionId, { ...this.jobRows.get(sessionId)!, state: "finished" });
        return {
          summary,
          usage: {
            inputTokens: childTotals.inputTokens,
            outputTokens: childTotals.outputTokens,
            cacheRead: childTotals.cacheReadTokens,
            cacheWrite: childTotals.cacheWriteTokens,
            ...(childTotals.cost !== undefined ? { cost: childTotals.cost } : {}),
          },
        };
      } finally {
        this.live.delete(sessionId);
        await child.close().catch(() => {});
      }
    } catch (error) {
      this.jobRows.set(sessionId, { ...this.jobRows.get(sessionId)!, state: "error" });
      throw error;
    } finally {
      this.releaseSlot();
    }
  }
  private async acquireSlot(): Promise<void> {
    if (this.activeSlots < this.maxAgents) {
      this.activeSlots += 1;
      return;
    }
    await new Promise<void>((release) => this.slotQueue.push(release));
    this.activeSlots += 1;
  }
  private releaseSlot(): void {
    this.activeSlots -= 1;
    this.slotQueue.shift()?.();
  }
}


function lastAssistantText(messages: UIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const text = m.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
}
