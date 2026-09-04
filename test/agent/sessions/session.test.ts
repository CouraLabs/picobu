import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage, UIMessageChunk } from "ai";
import { options, type ProviderOptions } from "@config/options.ts";
import {
  COMPACT_THRESHOLD,
  compactedMessageText,
  createSession,
  dropUnansweredPrompt,
  folderKeyFor,
  generateSessionId,
  listSessions,
  loadSession,
  sanitizeMessages,
  serializeForCompaction,
  sessionFilePath,
  SessionSaver,
  shouldCompact,
  stripUnreplayableReasoning,
} from "@agent/sessions/session.ts";
import type { LoopConfig, LoopMessage } from "@agent/loop/create-loop.ts";

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

const textMessage = (text: string): LoopMessage =>
  ({ id: text, role: "user", parts: [{ type: "text", text }] }) as LoopMessage;

const testConfig = (): LoopConfig => ({ agentId: "ask", modelKey: "unconfigured/none", thinking: "medium" });

//
// ── Mock provider (local OpenAI-compatible streaming server) ────────────────
//

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await sleep(5);
  }
}

/**
 * A local OpenAI-compatible chat-completions server. Each request is answered
 * with a short SSE stream that starts immediately (so the chat reaches
 * `streaming`) and holds for 150ms before finishing — long enough for a test
 * to enqueue/steer mid-run deterministically. Records the last user text of
 * every request in arrival order, plus the raw request bodies. With
 * `reasoning: true` the stream emits a reasoning delta and then holds —
 * mid-run there is only an (unsigned) reasoning part, no visible answer.
 */
function startMockProvider({ reasoning = false }: { reasoning?: boolean } = {}) {
  const requests: string[] = [];
  const payloads: Array<{ messages?: unknown }> = [];
  const extractText = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((p): p is { type: "text"; text: string } => typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text")
        .map((p) => p.text)
        .join("");
    }
    return "";
  };
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as { messages?: Array<{ role: string; content: unknown }>; response_format?: { type?: string } };
      payloads.push(body);
      const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
      requests.push(extractText(lastUser?.content));

      const enc = new TextEncoder();
      // Structured-output calls (`Output.object` → `response_format: json_object`)
      // expect a plain JSON chat completion, not an SSE stream.
      if (body.response_format?.type === "json_object") {
        return Response.json({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 0,
          model: "m1",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: '{"summary":"did the thing"}' },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
      const sse = (delta: object | undefined, finish?: string, usage?: object) =>
        enc.encode(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: 0,
            model: "m1",
            choices: delta === undefined ? [] : [{ index: 0, delta, finish_reason: finish ?? null }],
            ...(usage ? { usage } : {}),
          })}\n\n`,
        );
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(sse({}));
            if (reasoning) {
              controller.enqueue(sse({ reasoning: "pondering the question" }));
              await sleep(300); // hold mid-reasoning so a test can abort here
            }
            controller.enqueue(sse({ content: "ack" }));
            await sleep(150); // hold the run open so tests can steer mid-flight
            controller.enqueue(sse({}, "stop"));
            controller.enqueue(sse(undefined, undefined, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }));
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          } catch {
            // the client aborted the request (steer) — nothing to finish
          }
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });

  const provider: ProviderOptions = {
    id: "mock",
    name: "Mock",
    type: "openai-compatible",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    apiKey: "sk-test",
    models: [{ id: "m1", name: "M1", context: 128_000, output: 4_000, billing: { input: 3, output: 15 } }],
  };
  return { provider, requests, payloads, close: () => server.stop(true) };
}

//
// ── Persistence ─────────────────────────────────────────────────────────────
//

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

  test("sanitizes on load: preliminary tool outputs are dropped as non-final", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const sessionId = generateSessionId();
      const saver = new SessionSaver(sessionFilePath(folderKey, sessionId));
      // A streaming tool (e.g. websearch) saved mid-run: its output is a
      // progress snapshot, not the result.
      const streaming: UIMessage = {
        id: "m1",
        role: "assistant",
        parts: [
          {
            type: "tool-websearch",
            toolCallId: "t1",
            state: "output-available",
            preliminary: true,
            input: { query: "q" },
            output: { progress: "Fetching result 1 of 2…", results: [] },
          },
        ],
      };

      await saver.save([streaming]);

      const loaded = await loadSession(folderKey, sessionId);
      expect(loaded).toEqual([]);
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

describe("stripUnreplayableReasoning", () => {
  const reasoningPart = (text: string, signature?: string) =>
    ({
      type: "reasoning",
      text,
      ...(signature ? { providerMetadata: { anthropic: { signature } } } : {}),
    }) as unknown as UIMessage["parts"][number];

  test("drops unsigned reasoning, keeps signed and redacted blocks and every other part", () => {
    const messages: UIMessage[] = [
      userMsg("u1", "hello"),
      assistantMsg("a1", [reasoningPart("unsigned thoughts"), { type: "text", text: "partial" }]),
      assistantMsg("a2", [reasoningPart("signed thoughts", "sig-1")]),
      assistantMsg("a3", [
        {
          type: "reasoning",
          text: "redacted",
          providerMetadata: { anthropic: { redactedData: "blob" } },
        } as unknown as UIMessage["parts"][number],
      ]),
    ];

    const stripped = stripUnreplayableReasoning(messages);

    // User messages pass through untouched.
    expect(stripped[0]).toBe(messages[0]);
    expect((stripped[1]?.parts as Array<{ text: string }>).map((p) => p.text)).toEqual(["partial"]);
    expect((stripped[2]?.parts as Array<{ text: string }>).map((p) => p.text)).toEqual(["signed thoughts"]);
    expect(stripped[3]?.parts).toHaveLength(1);
  });

  test("assistant messages without reasoning are returned as-is", () => {
    const msgs = [userMsg("u1", "hello"), assistantMsg("a1", [{ type: "text", text: "hi" }])];
    const stripped = stripUnreplayableReasoning(msgs);
    expect(stripped[0]).toBe(msgs[0]);
    expect(stripped[1]).toBe(msgs[1]);
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

//
// ── Compaction ──────────────────────────────────────────────────────────────
//

describe("shouldCompact", () => {
  test("triggers at exactly the threshold", () => {
    expect(shouldCompact(80, 100)).toBe(true);
  });

  test("does not trigger below the threshold", () => {
    expect(shouldCompact(79, 100)).toBe(false);
  });

  test("threshold is 80% of the context window", () => {
    expect(COMPACT_THRESHOLD).toBe(0.8);
    expect(shouldCompact(160_000, 200_000)).toBe(true);
    expect(shouldCompact(159_999, 200_000)).toBe(false);
  });

  test("never triggers with a zero window (avoids div-by-zero)", () => {
    expect(shouldCompact(10_000, 0)).toBe(false);
  });
});

describe("serializeForCompaction", () => {
  test("keeps user and assistant text verbatim, prefixed by role", () => {
    const transcript = serializeForCompaction([
      userMessage("fix the login bug"),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Fixed in src/auth.ts" }],
      },
    ]);
    expect(transcript).toBe(
      "user: fix the login bug\nassistant: Fixed in src/auth.ts",
    );
  });

  test("summarizes tool parts on one abbreviated line", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-write",
            state: "output-available",
            input: { path: "/tmp/a.txt", content: "hello" },
            output: "ok",
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toContain("tool write (output-available):");
    expect(transcript).toContain("/tmp/a.txt");
    expect(transcript).toContain("-> ok");
  });

  test("abbreviates long tool output", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-bash",
            state: "output-available",
            input: "ls",
            output: "x".repeat(1000),
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript.length).toBeLessThan(300);
    expect(transcript).toContain("…");
  });

  test("drops reasoning and blank parts", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "thinking hard" } as unknown as UIMessage["parts"][number],
          { type: "text", text: "   " } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toBe("");
  });

  test("reports tool errors", () => {
    const transcript = serializeForCompaction([
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-read",
            state: "output-error",
            input: { path: "/nope" },
            errorText: "file not found",
          } as unknown as UIMessage["parts"][number],
        ],
      },
    ]);
    expect(transcript).toContain("tool read (output-error):");
    expect(transcript).toContain("-> file not found");
  });
});

describe("compactedMessageText", () => {
  test("wraps the summary with the compaction header", () => {
    const text = compactedMessageText("did the thing");
    expect(text).toContain("[Session compacted");
    expect(text.endsWith("did the thing")).toBe(true);
  });
});

const userMessage = (text: string): UIMessage => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

//
// ── Session facade ──────────────────────────────────────────────────────────
//

describe("createSession", () => {  test("starts ready with a 16-hex session id and the initial messages", async () => {
    await withSessionsDir(async () => {
      const messages = [textMessage("history")];
      const session = await createSession(testConfig, { messages });
      expect(session.id).toMatch(/^[0-9a-f]{16}$/);
      expect(session.status).toBe("ready");
      expect(session.messages).toBe(messages);
      expect(session.lastMessage?.parts[0]).toEqual({ type: "text", text: "history" });
    });
  });

  test("the chat id is the sessionId the loop sees", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      expect(session.config.sessionId).toBe(session.id);
    });
  });

  test("each session owns its id, even from the same config", async () => {
    await withSessionsDir(async () => {
      const a = await createSession(testConfig);
      const b = await createSession(testConfig);
      expect(a.id).not.toBe(b.id);
      expect(b.config.sessionId).toBe(b.id);
    });
  });

  test("switchAgent validates against the registry and takes effect", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      expect(() => session.switchAgent("nope")).toThrow(/Unknown agent/);
      session.switchAgent("coder");
      expect(session.config.agentId).toBe("coder");
    });
  });

  test("switchModel validates against the provider registry and takes effect", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      expect(() => session.switchModel("ghost/nope")).toThrow();
      // A registered provider/model resolves without touching the network.
      const provider: ProviderOptions = {
        id: "test",
        name: "Test",
        type: "openai-compatible",
        baseUrl: "https://api.test.com/v1",
        apiKey: "sk-test",
        models: [{ id: "m1", name: "M1", context: 128_000, output: 4_000, billing: { input: 3, output: 15 } }],
      };
      const original = options.providers;
      options.providers = [provider];
      try {
        session.switchModel("test/m1");
        expect(session.config.modelKey).toBe("test/m1");
      } finally {
        options.providers = original;
      }
    });
  });

  test("switchThinking takes effect", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      session.switchThinking("high");
      expect(session.config.thinking).toBe("high");
    });
  });

  test("switch overrides win over the host config but sessionId always wins", async () => {
    await withSessionsDir(async () => {
      let config: LoopConfig = { ...testConfig() };
      const session = await createSession(() => config);
      session.switchAgent("plan-code");
      // Even if the host closure starts returning a different object, the
      // override sticks and the sessionId is forced.
      config = { agentId: "coder", modelKey: "x/y", thinking: "low", sessionMode: "persistent" };
      expect(session.config.agentId).toBe("plan-code");
      expect(session.config.modelKey).toBe("x/y");
      expect(session.config.sessionId).toBe(session.id);
    });
  });

  test("flush resolves after state changes", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      await expect(session.flush()).resolves.toBeUndefined();
    });
  });

  test("resumes an existing session id: saved messages are loaded", async () => {
    await withSessionsDir(async () => {
      const folderKey = folderKeyFor(options.app.cwd);
      const id = generateSessionId();
      const saved = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
      ] as LoopMessage[];
      await new SessionSaver(sessionFilePath(folderKey, id)).save(saved);

      const session = await createSession(testConfig, { id });
      expect(session.id).toBe(id);
      expect(session.config.sessionId).toBe(id);
      expect(session.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
      expect(session.lastMessage?.parts).toEqual(saved[1]?.parts);
    });
  });

  test("resuming an unknown id starts a fresh session under that id", async () => {
    await withSessionsDir(async () => {
      const id = generateSessionId();
      const session = await createSession(testConfig, { id });
      expect(session.id).toBe(id);
      expect(session.messages).toEqual([]);
    });
  });

  test("exposes skills, workflows, rules, and agents", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      expect(Array.isArray(session.skills)).toBe(true);
      expect(Array.isArray(session.workflows)).toBe(true);
      expect(Array.isArray(session.rules)).toBe(true);
      expect(session.agents.map((a) => a.id)).toContain("ask");
      expect(session.agents.map((a) => a.id)).toContain("coder");
    });
  });

  test("abort stops the run and drops every queued prompt", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        session.queue("one");
        await waitFor(() => session.status === "streaming");
        session.queue("two"); // queued behind the in-flight run

        session.abort();
        await waitFor(() => session.status === "ready");
        // The in-flight run was aborted ("one" only) and "two" is never sent —
        // not even after the abort settles (the mock holds 150ms per run).
        expect(mock.requests).toEqual(["one"]);
        await sleep(200);
        expect(mock.requests).toEqual(["one"]);
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("abort is a no-op when the session is idle", async () => {
    await withSessionsDir(async () => {
      const session = await createSession(testConfig);
      expect(() => session.abort()).not.toThrow();
      expect(session.status).toBe("ready");
    });
  });

  test("aborting mid-reasoning erases the turn so the truncated reasoning is never re-sent", async () => {
    await withSessionsDir(async () => {
      // The mock streams a reasoning delta and then holds: aborting mid-hold
      // leaves an assistant message with only an (unsigned) reasoning part.
      const mock = startMockProvider({ reasoning: true });
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        session.queue("think about it");
        await waitFor(() => session.status === "streaming");
        await sleep(20); // let the reasoning delta land before the abort
        session.abort();
        await waitFor(() => session.status === "ready" && session.messages.length === 0);
        // The interrupted turn — prompt and reasoning-only stub — is gone.
        expect(mock.requests).toEqual(["think about it"]);
        await sleep(200);
        expect(mock.requests).toEqual(["think about it"]); // nothing re-sent
        await session.flush();
        // The erased turn is tombstoned on disk, so a reload starts clean.
        expect(await loadSession(folderKeyFor(options.app.cwd), session.id)).toEqual([]);
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("unreplayable reasoning never reaches the provider on a continued send", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        // History as it would reload after a mid-reasoning interruption: an
        // unsigned reasoning stub alongside completed, signed thinking.
        const messages = [
          userMsg("u1", "hello"),
          assistantMsg("a1", [
            { type: "reasoning", text: "hidden thoughts" } as unknown as UIMessage["parts"][number],
            { type: "text", text: "partial answer" },
          ]),
          assistantMsg("a2", [
            {
              type: "reasoning",
              text: "signed thoughts",
              providerMetadata: { anthropic: { signature: "sig-1" } },
            } as unknown as UIMessage["parts"][number],
          ]),
        ] as LoopMessage[];
        const session = await createSession(
          () => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }),
          { messages },
        );

        session.queue("continue");
        await waitFor(() => session.status === "ready" && mock.requests.length === 1);
        await session.flush();

        const wire = JSON.stringify(mock.payloads.at(-1));
        expect(wire).not.toContain("hidden thoughts"); // unsigned block stripped
        expect(wire).toContain("partial answer"); // the rest of the history survives
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("stream yields the UI message chunks of a run to every subscriber", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));

        // Two subscribers attach before the run starts; both must observe
        // the same chunk sequence and both must end when the run settles.
        const chunksA: UIMessageChunk[] = [];
        const chunksB: UIMessageChunk[] = [];
        const consumeA = (async () => {
          for await (const chunk of session.stream()) chunksA.push(chunk);
        })();
        const consumeB = (async () => {
          for await (const chunk of session.stream()) chunksB.push(chunk);
        })();
        session.queue("hello");
        await Promise.all([consumeA, consumeB]);

        const text = (chunks: UIMessageChunk[]) =>
          chunks.filter((c): c is Extract<UIMessageChunk, { type: "text-delta" }> => c.type === "text-delta").map((c) => c.delta).join("");
        expect(text(chunksA)).toBe("ack");
        expect(text(chunksB)).toBe("ack");
        expect(chunksA.some((c) => c.type === "finish")).toBe(true);
        // The chat itself still received everything through the tee.
        await waitFor(() => session.status === "ready" && session.messages.length === 2);
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("streamMessages yields incrementally-growing snapshots of the streaming message", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));

        const snapshots: LoopMessage[] = [];
        const consume = (async () => {
          for await (const message of session.streamMessages()) snapshots.push(message);
        })();
        session.queue("hello");
        await consume;

        // One message, snapshotted repeatedly; parts grow as chunks arrive.
        const ids = new Set(snapshots.map((m) => m.id));
        expect(ids.size).toBe(1);
        expect(snapshots.length).toBeGreaterThan(1);
        const final = snapshots[snapshots.length - 1]!;
        const textParts = final.parts.filter((p) => p.type === "text");
        expect(textParts.map((p) => (p as { text: string }).text).join("")).toBe("ack");
        // The chat received the same finished message through the tee.
        await waitFor(() => session.status === "ready" && session.messages.length === 2);
        expect(final.id).not.toBe("");
        expect(final.role).toBe("assistant");
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("usage reports tokens, cost, ttft, and tps after a run", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        expect(session.usage).toBeUndefined(); // nothing has run yet

        session.queue("hello");
        await waitFor(() => session.status === "ready" && session.usage !== undefined);
        const usage = session.usage!;
        expect(usage.inputTokens).toBe(10);
        expect(usage.outputTokens).toBe(5);
        expect(typeof usage.ttftMs).toBe("number");
        expect(usage.tps).toBeGreaterThan(0);
        // (10 * $3 + 5 * $15) / 1M from the mock model's billing metadata.
        expect(usage.cost).toBeCloseTo(0.000105, 10);
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("compact replaces the messages with the model's summary", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        session.queue("do the thing");
        await waitFor(() => session.status === "ready");

        const result = await session.compact();
        expect(result.summary).toBe("did the thing");
        expect(session.messages).toHaveLength(1);
        expect(session.messages[0]?.role).toBe("user");
        expect((session.messages[0]?.parts[0] as { type: string; text: string }).text).toContain("[Session compacted");
        expect((session.messages[0]?.parts[0] as { type: string; text: string }).text).toContain("did the thing");

        // The compacted fresh state is persisted (the pre-compaction messages
        // are tombstoned on the next save).
        await session.flush();
        const loaded = await loadSession(folderKeyFor(options.app.cwd), session.id);
        expect(loaded).toEqual(session.messages);
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("queue sends prompts one at a time, after the current run finishes", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        session.queue("first");
        // Enqueued while the first run is in flight: the server holds each
        // response open for 150ms, so this cannot slip in before it settles.
        session.queue("second");

        await waitFor(() => mock.requests.length === 2);
        expect(mock.requests[0]).toBe("first");
        expect(mock.requests[1]).toBe("second");
        await waitFor(() => session.status === "ready" && session.messages.length === 4);
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("steer aborts the current run and sends the steering prompt next, ahead of the queue", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        session.queue("one");
        await waitFor(() => session.status === "streaming");
        session.queue("queued-behind");
        const steered = session.steer("steer now");

        await waitFor(() => mock.requests.length === 3);
        expect(mock.requests[0]).toBe("one");
        expect(mock.requests[1]).toBe("steer now"); // jumped ahead of queued-behind
        expect(mock.requests[2]).toBe("queued-behind");
        await steered; // resolves when the steering prompt's own run settles
        await waitFor(() => session.status === "ready");
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });

  test("steer sends immediately when the session is idle", async () => {
    await withSessionsDir(async () => {
      const mock = startMockProvider();
      const original = options.providers;
      options.providers = [mock.provider];
      try {
        const session = await createSession(() => ({ agentId: "ask", modelKey: "mock/m1", thinking: "medium" }));
        const steered = session.steer("go");
        await waitFor(() => mock.requests.length === 1);
        expect(mock.requests[0]).toBe("go");
        await steered;
        await waitFor(() => session.status === "ready" && session.messages.length === 2);
        await session.flush();
      } finally {
        mock.close();
        options.providers = original;
      }
    });
  });
});
