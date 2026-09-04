import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { options } from "@config/options.ts";
import {
  addToTotals,
  emptyTotals,
  isWaiting,
  readSessionMeta,
  recoverSessionMeta,
  updateSessionMeta,
  writeSessionMeta,
} from "@agent/sessions/session-meta.ts";

/** Redirect the sessions root to a temp dir (bun:test runs each file in its own process). */
async function withSessionsDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "picobu-meta-"));
  const original = options.app.systemDir;
  options.app.systemDir = dir;
  try {
    await fn(dir);
  } finally {
    options.app.systemDir = original;
    await rm(dir, { recursive: true, force: true });
  }
}

describe("session meta store", () => {
  test("writes, reads, and patches a meta sidecar", async () => {
    await withSessionsDir(async () => {
      await writeSessionMeta("proj", "s1", {
        id: "s1",
        state: "finished",
        cwd: "/tmp/proj",
        createdAt: 1,
        updatedAt: 1,
      });
      const meta = await readSessionMeta("proj", "s1");
      expect(meta?.state).toBe("finished");
      expect(meta?.cwd).toBe("/tmp/proj");

      await updateSessionMeta("proj", "s1", { title: "Hello", state: "waiting" });
      const updated = await readSessionMeta("proj", "s1");
      expect(updated?.title).toBe("Hello");
      expect(updated?.state).toBe("waiting");
      expect(updated?.cwd).toBe("/tmp/proj"); // patch does not clobber other fields
    });
  });

  test("missing and corrupt sidecars read as null", async () => {
    await withSessionsDir(async () => {
      expect(await readSessionMeta("proj", "gone")).toBeNull();
      await writeSessionMeta("proj", "bad", {
        id: "bad",
        state: "finished",
        cwd: "/x",
        createdAt: 1,
        updatedAt: 1,
      });
      // Corrupt the file directly (bypassing the store).
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(options.app.systemDir, "sessions", "proj", "bad.meta.json"), "{nope");
      expect(await readSessionMeta("proj", "bad")).toBeNull();
    });
  });

  test("crash recovery downgrades a stale running state to error", async () => {
    await withSessionsDir(async () => {
      await writeSessionMeta("proj", "crash", {
        id: "crash",
        state: "running",
        cwd: "/tmp/proj",
        createdAt: 1,
        updatedAt: 1,
      });
      const recovered = await recoverSessionMeta("proj", "crash");
      expect(recovered?.state).toBe("error");
      // Persisted: a plain read sees the recovered state.
      expect((await readSessionMeta("proj", "crash"))?.state).toBe("error");
      // Non-running metas pass through untouched.
      await writeSessionMeta("proj", "ok", {
        id: "ok",
        state: "finished",
        cwd: "/tmp/proj",
        createdAt: 1,
        updatedAt: 1,
      });
      expect((await recoverSessionMeta("proj", "ok"))?.state).toBe("finished");
    });
  });
});

describe("isWaiting", () => {
  const assistantWithTool = (type: string, output: unknown) => [
    { role: "user", parts: [{ type: "text", text: "hi" }] },
    { role: "assistant", parts: [{ type, toolCallId: "t1", state: "output-available", input: {}, output }] },
  ];

  test("is true for a trailing pending ask/plan-write output", () => {
    expect(isWaiting(assistantWithTool("tool-ask", { status: "pending", message: "m" }) as never)).toBe(true);
    expect(isWaiting(assistantWithTool("tool-plan-write", { status: "pending", message: "m" }) as never)).toBe(true);
  });

  test("is false for non-blocking tools, completed outputs, and user-last conversations", () => {
    expect(isWaiting(assistantWithTool("tool-read", { status: "pending" }) as never)).toBe(false);
    expect(isWaiting(assistantWithTool("tool-ask", { status: "done" }) as never)).toBe(false);
    expect(isWaiting([{ role: "user", parts: [{ type: "text", text: "answer" }] }] as never)).toBe(false);
    expect(isWaiting([] as never)).toBe(false);
  });

  test("self-clears once the user answers (last message is the user's)", () => {
    const waiting = assistantWithTool("tool-ask", { status: "pending", message: "m" });
    expect(isWaiting([...waiting, { role: "user", parts: [{ type: "text", text: "42" }] }] as never)).toBe(false);
  });
});

describe("addToTotals", () => {
  test("accumulates tokens, cost, and itemized details", () => {
    let totals = emptyTotals();
    totals = addToTotals(totals, {
      source: "run",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      cost: 0.2,
      inputCost: 0.1,
      outputCost: 0.08,
      cacheCost: 0.02,
    });
    totals = addToTotals(totals, {
      source: "subagent",
      sessionId: "child",
      inputTokens: 30,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0.1,
      inputCost: 0.06,
      outputCost: 0.04,
    });
    expect(totals.inputTokens).toBe(130);
    expect(totals.outputTokens).toBe(70);
    expect(totals.cacheReadTokens).toBe(10);
    expect(totals.cost).toBeCloseTo(0.3);
    expect(totals.costDetails.totalCost).toBeCloseTo(0.3);
    expect(totals.costDetails.inputCost).toBeCloseTo(0.16);
    expect(totals.costDetails.outputCost).toBeCloseTo(0.12);
    expect(totals.costDetails.cacheCost).toBeCloseTo(0.02);
    expect(totals.costDetails.details).toHaveLength(2);
    expect(totals.costDetails.details[1]?.source).toBe("subagent");
  });

  test("entries without cost keep token accumulation and leave cost undefined", () => {
    const totals = addToTotals(emptyTotals(), {
      source: "run",
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(totals.inputTokens).toBe(1);
    expect(totals.cost).toBeUndefined();
    expect(totals.costDetails.totalCost).toBeUndefined();
  });
});
