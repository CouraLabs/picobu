import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { options } from "./options";
import {
  dropUnansweredPrompt,
  folderKeyFor,
  generateSessionId,
  listSessions,
  loadSession,
  sanitizeMessages,
  sessionFilePath,
  SessionSaver,
} from "./sessions";

/**
 * Run `fn` with the sessions root redirected to a fresh temp dir, restoring the
 * real `options.app.systemDir` and cleaning up afterwards. bun:test runs each
 * file in its own process, so the swap cannot leak into other test files.
 */
async function withSessionsDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "picobu-sessions-"));
  const originalSystemDir = options.app.systemDir;
  options.app.systemDir = dir;
  try {
    await fn(dir);
  } finally {
    options.app.systemDir = originalSystemDir;
    await rm(dir, { recursive: true, force: true });
  }
}

describe("folderKeyFor", () => {
  test("sanitizes the cwd basename", () => {
    expect(folderKeyFor("/Users/x/Projects/My App/")).toBe("my-app");
  });

  test("degenerate input falls back to default", () => {
    expect(folderKeyFor("/")).toBe("default");
    expect(folderKeyFor("")).toBe("default");
  });
});

describe("generateSessionId", () => {
  test("is 16 lowercase hex digits and differs across calls", () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{16}$/);
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

describe("SessionSaver + loadSession", () => {
  test("roundtrips saved messages with identical id/role/parts", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const sessionId = generateSessionId();
      const userMsg: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] };
      const assistantMsg: UIMessage = {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "hi there" }],
      };

      await new SessionSaver(sessionFilePath(folderKey, sessionId)).save([userMsg, assistantMsg]);

      const loaded = await loadSession(folderKey, sessionId);
      expect(loaded?.map((m) => m.id)).toEqual(["u1", "a1"]);
      expect(loaded?.[0]?.role).toBe("user");
      expect(loaded?.[0]?.parts).toEqual(userMsg.parts);
      expect(loaded?.[1]?.role).toBe("assistant");
      expect(loaded?.[1]?.parts).toEqual(assistantMsg.parts);
    });
  });

  test("dedupes on load: latest content wins at the first position", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const sessionId = generateSessionId();
      const saver = new SessionSaver(sessionFilePath(folderKey, sessionId));
      const v1: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] };
      const v2: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "second" }] };

      await saver.save([v1]);
      await saver.save([v2]);

      const loaded = await loadSession(folderKey, sessionId);
      expect(loaded?.length).toBe(1);
      expect(loaded?.[0]?.id).toBe("u1");
      expect(loaded?.[0]?.parts).toEqual(v2.parts);
    });
  });

  test("sanitizes on load: dangling tool parts and empty messages are dropped", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const sessionId = generateSessionId();
      const saver = new SessionSaver(sessionFilePath(folderKey, sessionId));
      const dangling: UIMessage = {
        id: "m1",
        role: "assistant",
        parts: [{ type: "tool-read", toolCallId: "t1", state: "input-streaming", input: {} }],
      };
      const complete: UIMessage = {
        id: "m2",
        role: "assistant",
        parts: [
          { type: "tool-read", toolCallId: "t2", state: "output-available", input: {}, output: "ok" },
        ],
      };
      const emptyAfterStrip: UIMessage = {
        id: "m3",
        role: "assistant",
        parts: [{ type: "tool-bash", toolCallId: "t3", state: "input-available", input: {} }],
      };

      await saver.save([dangling, complete, emptyAfterStrip]);

      const loaded = await loadSession(folderKey, sessionId);
      expect(loaded?.map((m) => m.id)).toEqual(["m2"]);
      expect(loaded?.[0]?.parts).toEqual(complete.parts);
    });
  });
});

describe("listSessions", () => {
  test("orders by mtime desc and previews the first user text truncated to 60 chars", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const idA = generateSessionId();
      const idB = generateSessionId();
      const longUserText = `A: ${"x".repeat(80)}`;

      await new SessionSaver(sessionFilePath(folderKey, idA)).save([
        { id: "u1", role: "user", parts: [{ type: "text", text: longUserText }] },
      ]);
      await new SessionSaver(sessionFilePath(folderKey, idB)).save([
        { id: "u2", role: "user", parts: [{ type: "text", text: "B prompt" }] },
      ]);
      // Pin mtimes deterministically instead of sleeping on the wall clock.
      const older = new Date(Date.UTC(2024, 0, 1));
      const newer = new Date(Date.UTC(2024, 0, 2));
      await utimes(sessionFilePath(folderKey, idA), older, older);
      await utimes(sessionFilePath(folderKey, idB), newer, newer);

      const rows = await listSessions(folderKey);
      expect(rows.map((r) => r.id)).toEqual([idB, idA]);
      expect(rows[0]?.firstPrompt).toBe("B prompt");
      expect(rows[1]?.firstPrompt).toBe(`A: ${"x".repeat(54)}...`);
    });
  });

  test("missing dir yields an empty list", async () => {
    await withSessionsDir(async () => {
      expect(await listSessions("nope")).toEqual([]);
    });
  });
});

const userMsg = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

const assistantMsg = (id: string, parts: UIMessage["parts"]): UIMessage => ({
  id,
  role: "assistant",
  parts,
});

describe("dropUnansweredPrompt", () => {
  test("removes the prompt and its bare assistant stub when interrupted before any answer", () => {
    const done: UIMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Here you go." }] };
    const stub: UIMessage = { id: "a2", role: "assistant", parts: [{ type: "step-start" }, { type: "text", text: "" }] };
    const msgs = [userMsg("u1", "hello"), done, userMsg("u2", "quick question"), stub];
    expect(sanitizeMessages(dropUnansweredPrompt(msgs))).toEqual([userMsg("u1", "hello"), done]);
  });

  test("removes a trailing prompt whose assistant message never arrived (cancelled during submit)", () => {
    const msgs = [userMsg("u1", "hello"), assistantMsg("a1", [{ type: "text", text: "hi" }]), userMsg("u2", "cancel me")];
    expect(dropUnansweredPrompt(msgs)).toEqual(msgs.slice(0, 2));
  });

  test("keeps the prompt when a partial answer was already streamed", () => {
    const partial = assistantMsg("a1", [{ type: "text", text: "Let me look at" }]);
    const msgs = [userMsg("u1", "hello"), partial];
    expect(sanitizeMessages(dropUnansweredPrompt(msgs))).toEqual(msgs);
  });

  test("keeps the prompt when a tool call already completed", () => {
    const toolDone = assistantMsg("a1", [
      { type: "tool-read", toolCallId: "t1", state: "output-available", input: {}, output: "ok" },
    ]);
    const msgs = [userMsg("u1", "read the file"), toolDone];
    expect(sanitizeMessages(dropUnansweredPrompt(msgs))).toEqual(msgs);
  });

  test("reasoning-only output still counts as unanswered", () => {
    const reasoning = assistantMsg("a1", [{ type: "reasoning", text: "hmm, let me think" }]);
    const msgs = [userMsg("u1", "quick one"), reasoning];
    expect(sanitizeMessages(dropUnansweredPrompt(msgs))).toEqual([]);
  });

  test("completed turns are untouched", () => {
    const msgs = [userMsg("u1", "hello"), assistantMsg("a1", [{ type: "text", text: "hi!" }])];
    expect(dropUnansweredPrompt(msgs)).toBe(msgs);
  });
});

describe("session tombstones", () => {
  test("a message removed from the conversation is erased from the saved file on load", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const sessionId = generateSessionId();
      const saver = new SessionSaver(sessionFilePath(folderKey, sessionId));

      const answered: UIMessage[] = [
        userMsg("u1", "hello"),
        assistantMsg("a1", [{ type: "text", text: "hi" }]),
        userMsg("u2", "cancel me"),
      ];
      await saver.save(answered);

      // Interrupt: the unanswered prompt and its bare assistant stub vanish
      // from the conversation; re-saving tombstones them on disk.
      const afterInterrupt = sanitizeMessages(
        dropUnansweredPrompt([...answered, { id: "a2", role: "assistant", parts: [{ type: "step-start" }] }]),
      );
      await saver.save(afterInterrupt);
      await saver.flush();

      expect(await loadSession(folderKey, sessionId)).toEqual(afterInterrupt);
      expect(afterInterrupt.map((m) => m.id)).toEqual(["u1", "a1"]);
    });
  });
});

