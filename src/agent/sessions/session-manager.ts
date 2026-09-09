import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  options,
  resolveModelRole,
  type ProviderModelReasoningEffort,
} from "@config/options.ts";
import {
  createSession,
  type Session,
} from "@agent/sessions/session.ts";
import {
  folderKeyFor,
  generateSessionId,
} from "@agent/sessions/session-paths.ts";
import { loadSession } from "@agent/sessions/session-store.ts";
import {
  folderKeyForSession,
  readSessionMeta,
  recoverSessionMeta,
  updateSessionMeta,
  writeSessionMeta,
} from "@agent/sessions/session-meta.ts";
import { JobTracker, type JobRow } from "@agent/sessions/session-jobs.ts";
import { forkSession } from "@agent/sessions/session-fork.ts";
import {
  listSessionsFor,
  listSessionTree,
  deleteSessionCascade,
  type SessionListRow,
} from "@agent/sessions/session-queries.ts";
import { spawnSubSession, type SpawnSubSessionParams } from "@agent/sessions/session-spawn.ts";
import type { ChatChangeHandler } from "@agent/sessions/session-headless-chat.ts";
import type { AgentType } from "@agent/agents/types.ts";
import type { LoopConfig } from "@agent/loop/create-loop.ts";
import type { UIMessage } from "ai";

export type { JobRow, SpawnSubSessionParams, SessionListRow };
export type CreateSessionOptions = {
  id?: string;
  agentId?: string;
  modelKey?: string;
  title?: string;
  autoCompact?: boolean;
  forkOnCompact?: boolean;
  onChange?: ChatChangeHandler;
};
const DEFAULT_MAX_AGENTS = 4;

export class SessionManager {
  private cwd: string;
  private _sandboxEnabled = true;
  private readonly _maxAgents: number;
  private readonly live = new Map<string, Session>();
  private readonly jobTracker = new JobTracker();
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
    const session = await createSession({
      config: () => this.baseConfig({ agentId: init.agentId, modelKey: init.modelKey, sessionId: id }),
      id,
      meta: { cwd: this.cwd, title: init.title, forkHost: () => this.forkSession(id).then((r) => r.sessionId) },
      autoCompact: init.autoCompact,
      forkOnCompact: init.forkOnCompact,
      ...(init.onChange ? { onChange: init.onChange } : {}),
    });
    this.live.set(id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.live.get(id);
  }

  async loadMessages(id: string): Promise<UIMessage[] | null> {
    const folderKey = await folderKeyForSession(this.cwd, id);
    return loadSession(folderKey, id);
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
    const folderKey = await folderKeyForSession(this.cwd, id);
    const updated = await updateSessionMeta(folderKey, id, { title });
    if (!updated) {
      const meta = await readSessionMeta(folderKey, id);
      if (meta) await writeSessionMeta(folderKey, id, { ...meta, title });
      else throw new Error(`Unknown session "${id}"`);
    }
  }

  async forkSession(id: string, opts: { fromCompaction?: boolean; upToMessageId?: string } = {}): Promise<{ sessionId: string }> {
    return forkSession(
      { cwd: this.cwd, live: this.live, startSession: (forkId) => this.startSession({ id: forkId }) },
      id,
      opts,
    );
  }

  async listSessions(): Promise<SessionListRow[]> {
    return listSessionsFor({ cwd: this.cwd, live: this.live, jobs: this.jobTracker });
  }

  async listSessionTree() {
    return listSessionTree(this.cwd);
  }

  async deleteSession(id: string): Promise<number> {
    return deleteSessionCascade({ cwd: this.cwd, live: this.live, jobs: this.jobTracker }, id);
  }

  jobs(): JobRow[] {
    return this.jobTracker.all();
  }

  onJobs(listener: (rows: JobRow[]) => void): () => void {
    return this.jobTracker.onJobs(listener);
  }

  abortJob(sessionId: string): void {
    this.live.get(sessionId)?.abort();
  }

  abortAll(): void {
    for (const session of this.live.values()) session.abort();
  }

  async spawnSubSession(params: SpawnSubSessionParams): Promise<{
    summary: string;
    usage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; cost?: number };
  }> {
    return spawnSubSession(
      {
        manager: this,
        cwd: this.cwd,
        maxAgents: this._maxAgents,
        live: this.live,
        jobs: this.jobTracker,
        baseConfig: (overrides) => this.baseConfig(overrides),
      },
      params,
    );
  }
}
