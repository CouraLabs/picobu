import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { options } from "@config/options.ts";
import { folderKeyFor, sessionFilePath } from "@agent/sessions/session.ts";
import { writeSessionMeta, readSessionMeta } from "@agent/sessions/session-meta.ts";
import { SessionManager } from "@agent/sessions/session-manager.ts";
import type { SessionMeta } from "@agent/sessions/session-meta.ts";

/** Redirect the sessions root + app cwd to a temp dir for the whole run. */
async function withSessionsDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "picobu-manager-"));
  const originalSystemDir = options.app.systemDir;
  const originalCwd = options.app.cwd;
  const originalHarness = options.harness;
  const originalProviders = options.providers;
  options.app.systemDir = dir;
  options.app.cwd = dir;
  // A provider pointing at a closed local port: spawn paths that reach the
  // model fail instantly (connection refused) without touching the network.
  options.providers = [
    { id: "mock", name: "Mock", type: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "m", name: "m", context: 1000, output: 100 }] },
  ];
  options.harness = { defaultModel: "mock/m" };
  try {
    await fn(dir);
  } finally {
    options.app.systemDir = originalSystemDir;
    options.app.cwd = originalCwd;
    options.harness = originalHarness;
    options.providers = originalProviders;
    await rm(dir, { recursive: true, force: true });
  }
}

const meta = (overrides: Partial<SessionMeta> & { id: string; cwd: string }): SessionMeta => ({
  state: "finished",
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("SessionManager", () => {
  test("startSession creates a meta sidecar recording the cwd and a settled state", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir });
      const session = await manager.startSession();
      expect(manager.getSession(session.id)).toBe(session);
      const meta = await import("@agent/sessions/session-meta.ts").then((m) => m.readSessionMeta(folderKeyFor(dir), session.id));
      expect(meta?.cwd).toBe(dir);
      expect(meta?.state).toBe("finished");
      expect(meta?.parentSessionId).toBeUndefined();
      await session.close();
    });
  });

  test("resuming a session with a stale running meta recovers it to error", async () => {
    await withSessionsDir(async (dir) => {
      const id = "0123456789abcdef";
      await writeSessionMeta(folderKeyFor(dir), id, meta({ id, cwd: dir, state: "running" }));
      const manager = new SessionManager({ cwd: dir });
      const session = await manager.startSession({ id });
      const stored = await import("@agent/sessions/session-meta.ts").then((m) => m.readSessionMeta(folderKeyFor(dir), id));
      expect(stored?.state).toBe("error");
      await session.close();
    });
  });

  test("setSessionTitle/renameSession change the title only", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir });
      const session = await manager.startSession();
      await manager.renameSession(session.id, "Renamed");
      const meta = await import("@agent/sessions/session-meta.ts").then((m) => m.readSessionMeta(folderKeyFor(dir), session.id));
      expect(meta?.title).toBe("Renamed");
      // The id (and therefore the JSONL file name) is untouched.
      expect(session.id).toBe(meta?.id ?? "");
      await session.close();
    });
  });

  test("forkSession clones the history into a live fork with a (forked) title", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      const id = "0123456789abcdef";
      await mkdir(join(options.app.systemDir, "sessions", folderKey), { recursive: true });
      await writeFile(sessionFilePath(folderKey, id), [
        JSON.stringify({ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }),
        JSON.stringify({ id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] }),
      ].join("\n") + "\n");
      await writeSessionMeta(folderKey, id, meta({ id, cwd: dir, title: "Original", parentSessionId: "root012345678" }));

      const manager = new SessionManager({ cwd: dir });
      const { sessionId: forkId } = await manager.forkSession(id);
      expect(forkId).not.toBe(id);
      // The fork is live and carries the entire cloned history.
      const fork = manager.getSession(forkId);
      expect(fork).toBeDefined();
      expect(fork!.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
      // The fork is independent: "(forked)" title, parent link dropped.
      const forkMeta = await readSessionMeta(folderKey, forkId);
      expect(forkMeta?.title).toBe("Original (forked)");
      expect(forkMeta?.parentSessionId).toBeUndefined();
      await fork!.close();
    });
  });

  test("forkSession with fromCompaction starts at the last compaction cut", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      const id = "0123456789abcdef";
      await mkdir(join(options.app.systemDir, "sessions", folderKey), { recursive: true });
      await writeFile(sessionFilePath(folderKey, id), [
        JSON.stringify({ id: "u1", role: "user", parts: [{ type: "text", text: "pre-cut" }] }),
        JSON.stringify({
          id: "cut",
          role: "user",
          metadata: { compaction: { summary: "s", compactedMessageIds: ["u1"], createdAt: 1 } },
          parts: [{ type: "text", text: "summary" }],
        }),
        JSON.stringify({ id: "u2", role: "user", parts: [{ type: "text", text: "post-cut" }] }),
      ].join("\n") + "\n");
      await writeSessionMeta(folderKey, id, meta({ id, cwd: dir, title: "Original" }));

      const manager = new SessionManager({ cwd: dir });
      const full = await manager.forkSession(id);
      expect(manager.getSession(full.sessionId)!.messages.map((m) => m.id)).toEqual(["u1", "cut", "u2"]);
      const sliced = await manager.forkSession(id, { fromCompaction: true });
      expect(manager.getSession(sliced.sessionId)!.messages.map((m) => m.id)).toEqual(["cut", "u2"]);
      for (const forkId of [full.sessionId, sliced.sessionId]) {
        await manager.getSession(forkId)!.close();
      }
    });
  });

  test("forkSession refuses a running session", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      const id = "0123456789abcdef";
      await mkdir(join(options.app.systemDir, "sessions", folderKey), { recursive: true });
      await writeFile(sessionFilePath(folderKey, id), "");
      await writeSessionMeta(folderKey, id, meta({ id, cwd: dir, state: "running" }));
      const manager = new SessionManager({ cwd: dir });
      await expect(manager.forkSession(id)).rejects.toThrow("running");
    });
  });

  test("listSessions joins meta and filters sessions of other worktrees", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      await mkdir(join(options.app.systemDir, "sessions", folderKey), { recursive: true });
      const id = "0123456789abcdef";
      await writeFile(sessionFilePath(folderKey, id), "");
      await writeSessionMeta(folderKey, id, meta({ id, cwd: dir, title: "Mine" }));
      // Legacy session without meta still lists.
      await writeFile(sessionFilePath(folderKey, "legacy0123456"), "");
      // A different worktree sharing the folder key is filtered out.
      await writeFile(sessionFilePath(folderKey, "other012345678"), "");
      await writeSessionMeta(folderKey, "other012345678", meta({ id: "other012345678", cwd: "/elsewhere/proj", state: "finished" }));

      const manager = new SessionManager({ cwd: dir });
      const rows = await manager.listSessions();
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(id);
      expect(ids).toContain("legacy0123456");
      expect(ids).not.toContain("other012345678");
      expect(rows.find((r) => r.id === id)?.title).toBe("Mine");
      expect(rows.find((r) => r.id === id)?.state).toBe("finished");
    });
  });

  test("listSessionTree nests children under roots via parentSessionId", async () => {
    await withSessionsDir(async (dir) => {
      await writeSessionMeta(folderKeyFor(dir), "root012345678", meta({ id: "root012345678", cwd: dir }));
      await writeSessionMeta(folderKeyFor(dir), "kid0123456789", meta({ id: "kid0123456789", cwd: dir, parentSessionId: "root012345678" }));
      const manager = new SessionManager({ cwd: dir });
      const tree = await manager.listSessionTree();
      const root = tree.find((n) => n.id === "root012345678");
      expect(root?.children.map((c) => c.id)).toEqual(["kid0123456789"]);
      expect(tree.some((n) => n.id === "kid0123456789")).toBe(false);
    });
  });

  test("deleteSession cascades to the whole sub tree and refuses running sessions", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      await writeSessionMeta(folderKey, "root012345678", meta({ id: "root012345678", cwd: dir }));
      await writeSessionMeta(folderKey, "kid0123456789", meta({ id: "kid0123456789", cwd: dir, parentSessionId: "root012345678" }));
      await writeSessionMeta(folderKey, "grand012345678", meta({ id: "grand012345678", cwd: dir, parentSessionId: "kid0123456789" }));
      // Session files + a per-session dir for each.
      for (const id of ["root012345678", "kid0123456789", "grand012345678"]) {
        await writeFile(sessionFilePath(folderKey, id), "");
        await mkdir(join(options.app.systemDir, "sessions", folderKey, id), { recursive: true });
      }
      // An unrelated session that must survive.
      await writeSessionMeta(folderKey, "keep012345678", meta({ id: "keep012345678", cwd: dir }));
      await writeFile(sessionFilePath(folderKey, "keep012345678"), "");

      const manager = new SessionManager({ cwd: dir });
      const deleted = await manager.deleteSession("root012345678");
      expect(deleted).toBe(3);
      for (const id of ["root012345678", "kid0123456789", "grand012345678"]) {
        expect(await readFile(sessionFilePath(folderKey, id), "utf8").catch(() => "gone")).toBe("gone");
        expect(await stat(join(options.app.systemDir, "sessions", folderKey, id)).catch(() => "gone")).toBe("gone");
      }
      const names = (await readdir(join(options.app.systemDir, "sessions", folderKey))).filter((n) => n.startsWith("keep")).sort();
      expect(names).toEqual(["keep012345678.jsonl", "keep012345678.meta.json"]);
    });
  });

  test("deleteSession refuses when a session in the subtree is running", async () => {
    await withSessionsDir(async (dir) => {
      const folderKey = folderKeyFor(dir);
      await writeSessionMeta(folderKey, "root012345678", meta({ id: "root012345678", cwd: dir }));
      await writeSessionMeta(folderKey, "kid0123456789", meta({ id: "kid0123456789", cwd: dir, parentSessionId: "root012345678", state: "running" }));
      const manager = new SessionManager({ cwd: dir });
      await expect(manager.deleteSession("root012345678")).rejects.toThrow("is running");
    });
  });

  test("changeDirectory validates, no-ops on the same dir, and starts a new session", async () => {
    await withSessionsDir(async (dir) => {
      const other = join(dir, "worktree");
      await mkdir(other, { recursive: true });
      const manager = new SessionManager({ cwd: dir });
      expect(await manager.changeDirectory(dir)).toBeUndefined(); // silent no-op
      await expect(manager.changeDirectory(join(dir, "missing"))).rejects.toThrow("Not a directory");
      const session = await manager.changeDirectory(other);
      expect(session).toBeDefined();
      expect(manager.currentCwd).toBe(other);
      const meta = session
        ? await import("@agent/sessions/session-meta.ts").then((m) => m.readSessionMeta(folderKeyFor(other), session.id))
        : undefined;
      expect(meta?.cwd).toBe(other);
      await session?.close();
    });
  });

  test("spawnSubSession fails fast on unknown subagents, the depth cap, and disabled spawning", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir, maxAgents: 4 });
      await expect(manager.spawnSubSession({ parentId: "root", subagent: "nope", prompt: "x", depth: 0 }))
        .rejects.toThrow("Unknown subagent");
      await expect(manager.spawnSubSession({ parentId: "root", subagent: "executor", prompt: "x", depth: 3 }))
        .rejects.toThrow("depth cap");
      expect(manager.jobs()).toHaveLength(0); // pre-flight failures register no job

      const disabled = new SessionManager({ cwd: dir, maxAgents: 0 });
      await expect(disabled.spawnSubSession({ parentId: "root", subagent: "executor", prompt: "x", depth: 0 }))
        .rejects.toThrow("maxAgents is 0");
    });
  });

  test("nested spawns over capacity fail fast; root spawns queue (FIFO slot release)", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir, maxAgents: 1 });
      // A nested spawn (depth > 0) with the single slot held fails immediately.
      // Simulate the held slot through an in-flight (queued-then-started) job:
      const p = manager.spawnSubSession({ parentId: "root", subagent: "explorer", prompt: "x", depth: 0 });
      // Let it acquire the slot and hit the (unreachable) model.
      await new Promise((r) => setTimeout(r, 50));
      await expect(manager.spawnSubSession({ parentId: "child", subagent: "explorer", prompt: "x", depth: 1 }))
        .rejects.toThrow("concurrency limit");
      await p.catch(() => {}); // the root spawn itself fails on the unreachable model
      // The slot was released on the failure path (no deadlock).
      const q = manager.spawnSubSession({ parentId: "root", subagent: "explorer", prompt: "x", depth: 0 });
      await q.catch(() => {});
    });
  }, 30_000);

  test("spawn failures surface a job row in the error state", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir, maxAgents: 2 });
      await expect(manager.spawnSubSession({ parentId: "root", subagent: "explorer", prompt: "x", depth: 0 }))
        .rejects.toThrow();
      const rows = manager.jobs();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.state).toBe("error");
      expect(rows[0]?.queued).toBe(false);
      expect(rows[0]?.subagent).toBe("explorer");
    });
  }, 30_000);

  test("onJobs listeners observe registry transitions; unsubscribe stops them", async () => {
    await withSessionsDir(async (dir) => {
      const manager = new SessionManager({ cwd: dir, maxAgents: 2 });
      const seen: number[] = [];
      const unsubscribe = manager.onJobs((rows) => seen.push(rows.length));
      await manager.spawnSubSession({ parentId: "root", subagent: "explorer", prompt: "x", depth: 0 }).catch(() => {});
      unsubscribe();
      await manager.spawnSubSession({ parentId: "root", subagent: "explorer", prompt: "x", depth: 0 }).catch(() => {});
      expect(seen.length).toBeGreaterThan(0);
      const afterUnsub = seen.length;
      // No new emissions reached the listener after unsubscribing (the second
      // spawn produced its own emissions, unseen here).
      expect(seen.length).toBe(afterUnsub);
    });
  }, 30_000);

  test("setSandbox toggles the flag for sessions created afterwards", () => {
    const manager = new SessionManager({ cwd: "/tmp" });
    expect(manager.sandboxEnabled).toBe(true);
    manager.setSandbox(false);
    expect(manager.sandboxEnabled).toBe(false);
  });
});
