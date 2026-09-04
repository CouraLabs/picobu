import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
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

/** A spawned sub session as observed by the job registry. */
export type JobRow = {
  sessionId: string;
  parentId: string;
  subagent: string;
  state: SessionState;
  /** True while the spawn waits for a concurrency slot (not started yet). */
  queued: boolean;
  startedAt: number;
};

export type SpawnSubSessionParams = {
  parentId: string;
  subagent: string;
  prompt: SessionPrompt;
  /** Nesting depth of the caller (a root session is depth 0). */
  depth: number;
};

export type CreateSessionOptions = {
  id?: string;
  agentId?: string;
  modelKey?: string;
  title?: string;
};

const DEFAULT_MAX_AGENTS = 4;

/**
 * Owns the session lifecycle: creation, listing, renaming (title only),
 * deletion (cascading to sub sessions), directory switching (starts a NEW
 * session), the sandbox toggle, the `maxAgents` concurrency cap, and the job
 * registry for spawned sub sessions.
 *
 * The cwd is owned here — `options.app.cwd` is read once as a bootstrap
 * default and never written back. Sessions in different worktrees run
 * concurrently, each with its own sandbox.
 */
export class SessionManager {
  private cwd: string;
  private _sandboxEnabled = true;
  private readonly _maxAgents: number;
  /** Live sessions created by this manager, keyed by id. */
  private readonly live = new Map<string, Session>();
  /** Job registry: active + recently settled sub sessions. */
  private readonly jobRows = new Map<string, JobRow>();
  private readonly jobListeners = new Set<(rows: JobRow[]) => void>();
  /** FIFO queue of slot waiters (spawned sessions only; roots never count). */
  private readonly slotQueue: Array<() => void> = [];
  private activeSlots = 0;

  constructor(init: { cwd?: string; maxAgents?: number } = {}) {
    this.cwd = resolve(init.cwd ?? options.app.cwd);
    this._maxAgents = init.maxAgents ?? options.harness.maxAgents ?? DEFAULT_MAX_AGENTS;
  }

  /** The manager's current working directory (per-session worktree root). */
  get currentCwd(): string {
    return this.cwd;
  }

  /** Concurrency cap for spawned sub sessions (0 = spawning disabled). */
  get maxAgents(): number {
    return this._maxAgents;
  }

  //
  // ── Configuration ─────────────────────────────────────────────────────────
  //

  /** Enable/disable the sandbox. Applies to sessions created from now on;
   * running sessions keep their loop's sandbox. Runtime-only (not persisted). */
  setSandbox(enabled: boolean): void {
    this._sandboxEnabled = enabled;
  }

  get sandboxEnabled(): boolean {
    return this._sandboxEnabled;
  }

  /** Base loop config for a new session in the current cwd. */
  private baseConfig(overrides: { agentId?: string; modelKey?: string; sessionId?: string; agentOverride?: AgentType; subagent?: boolean; spawn?: LoopConfig["spawn"] } = {}): LoopConfig {
    let modelKey = overrides.modelKey;
    let thinking: ProviderModelReasoningEffort | undefined;
    if (!modelKey) {
      try {
        const role = resolveModelRole(options.harness, "flash");
        modelKey = role.modelKey;
        thinking = role.thinking;
      } catch {
        // No model configured yet — the loop constructs with a placeholder
        // and the host can `switchModel` once one is available.
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

  //
  // ── Session lifecycle ─────────────────────────────────────────────────────
  //

  /**
   * Start a session in the current cwd. With `id`, resume the saved session
   * (crash recovery: a stale `running` meta is downgraded to `error` first).
   */
  async startSession(init: CreateSessionOptions = {}): Promise<Session> {
    const id = init.id ?? generateSessionId();
    const folderKey = folderKeyFor(this.cwd);

    // Crash recovery applies to sessions not live in this process.
    if (!this.live.has(id)) await recoverSessionMeta(folderKey, id);

    const session = await createSession(() => this.baseConfig({ agentId: init.agentId, modelKey: init.modelKey, sessionId: id }), {
      id,
      meta: { cwd: this.cwd, title: init.title },
    });
    this.live.set(id, session);
    return session;
  }

  /** A session created by this manager (undefined for foreign ids). */
  getSession(id: string): Session | undefined {
    return this.live.get(id);
  }

  /** Load any saved session's messages (folder key derived from meta cwd when present). */
  async loadMessages(id: string): Promise<UIMessage[] | null> {
    const folderKey = await this.folderKeyForSession(id);
    return loadSession(folderKey, id);
  }

  /** Resolve a session's folder key: the meta cwd when recorded, else the current cwd. */
  private async folderKeyForSession(id: string): Promise<string> {
    const meta = await readSessionMeta(folderKeyFor(this.cwd), id);
    return folderKeyFor(meta?.cwd ?? this.cwd);
  }

  /**
   * Change the working directory. Starts a NEW session under the new
   * worktree's folder key; existing sessions keep running untouched (no
   * concurrency gate — sessions in other worktrees are independent). A no-op
   * when the path equals the current cwd.
   */
  async changeDirectory(path: string): Promise<Session | undefined> {
    const next = resolve(path);
    const info = await stat(next).catch(() => undefined);
    if (!info?.isDirectory()) throw new Error(`Not a directory: ${next}`);
    if (next === this.cwd) return undefined; // silent no-op
    this.cwd = next;
    return this.startSession();
  }

  /** Rename = set the title only (id and JSONL filename are immutable). */
  async renameSession(id: string, title: string): Promise<void> {
    return this.setSessionTitle(id, title);
  }

  async setSessionTitle(id: string, title: string): Promise<void> {
    const folderKey = await this.folderKeyForSession(id);
    const updated = await updateSessionMeta(folderKey, id, { title });
    if (!updated) {
      // Legacy session without a sidecar: create a minimal one.
      const meta = await readSessionMeta(folderKey, id);
      if (meta) await writeSessionMeta(folderKey, id, { ...meta, title });
      else throw new Error(`Unknown session "${id}"`);
    }
  }

  //
  // ── Listing ───────────────────────────────────────────────────────────────
  //

  /** List saved sessions for the current cwd's folder key, newest first,
   * joined with their meta (title/state/parent/cwd). Sessions whose meta
   * records a different cwd are excluded (same-basename worktrees). */
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
      // Meta-less (legacy) sessions always show; meta-cwd filtering keeps
      // same-basename worktrees from mixing.
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

  /** The session tree for the current cwd: roots with their nested children. */
  async listSessionTree(): Promise<Array<SessionMeta & { children: SessionMeta[] }>> {
    const folderKey = folderKeyFor(this.cwd);
    const metas = await this.readAllMetas(folderKey);
    const childrenOf = (parentId: string): SessionMeta[] =>
      metas.filter((m) => m.parentSessionId === parentId);
    return metas
      .filter((m) => !m.parentSessionId)
      .map((root) => ({ ...root, children: childrenOf(root.id) }));
  }

  /** All meta sidecars for a folder key (corrupt/missing entries skipped). */
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

  //
  // ── Deletion ──────────────────────────────────────────────────────────────
  //

  /**
   * Delete a session and cascade to every sub session below it
   * (all-or-nothing: the whole subtree must be non-running). Returns the
   * number of deleted sessions (target + descendants).
   */
  async deleteSession(id: string): Promise<number> {
    const folderKey = await this.folderKeyForSession(id);
    const subtree = await this.collectSubtree(folderKey, id);
    // All-or-nothing: every session in the subtree must be settled. A meta
    // stuck in `running` for a non-live session means another process owns it.
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
      // Per-session dir (checkpoints, todo list).
      await rm(join(options.app.systemDir, "sessions", folderKey, nodeId), { recursive: true, force: true }).catch(() => {});
    }
    return subtree.length;
  }

  /** The session and every descendant via the meta parent links. */
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

  //
  // ── Job registry ──────────────────────────────────────────────────────────
  //

  /** Snapshot of the job registry (active + recently settled sub sessions). */
  jobs(): JobRow[] {
    return [...this.jobRows.values()];
  }

  /** Subscribe to job-registry changes; returns an unsubscribe function. */
  onJobs(listener: (rows: JobRow[]) => void): () => void {
    this.jobListeners.add(listener);
    return () => this.jobListeners.delete(listener);
  }

  private emitJobs(): void {
    const rows = this.jobs();
    for (const listener of this.jobListeners) listener(rows);
  }

  /** Abort a running job (cascading to its own children). */
  abortJob(sessionId: string): void {
    this.live.get(sessionId)?.abort();
  }

  /** Abort every live session and its sub sessions (e.g. on host shutdown). */
  abortAll(): void {
    for (const session of this.live.values()) session.abort();
  }

  //
  // ── Spawning ──────────────────────────────────────────────────────────────
  //

  /**
   * Spawn a sub session from a subagent definition and run its prompt to
   * settlement. Concurrency (`maxAgents`, depth-inclusive, spawned sessions
   * only) follows the deadlock-free rule: a root-level spawn over capacity
   * queues FIFO; a nested spawn (the caller already holds a slot) fails fast
   * so a cycle of blocked holders can never deadlock the queue.
   */
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

    // Nested spawn (caller holds a slot): never queue — fail fast so holders
    // blocked on their own children cannot starve the queue (deadlock rule).
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
      // Model: the subagent's explicit `provider/model` key wins, else the
      // parent's current model.
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
        // An errored run (model failure, aborted stream) must surface: the
        // chat swallows stream errors into its error state, so check it.
        if (child.error) throw child.error;
        // Settle → summarize → close: the summary is the deliverable; the
        // child's MCP clients are closed after the model call.
        const result = await child.summarize().catch(() => undefined);
        const summary = result?.summary ?? lastAssistantText(child.messages) ?? "(sub agent produced no output)";
        const childTotals = child.totals;
        // Roll the child's usage into the parent's lifetime totals.
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

/** Last assistant text of a conversation: the sub agent's raw deliverable. */
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
