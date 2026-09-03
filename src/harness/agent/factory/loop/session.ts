import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  AbstractChat,
  generateId,
  generateText,
  Output,
  readUIMessageStream,
  type AsyncIterableStream,
  type ChatInit,
  type ChatState,
  type ChatStatus,
  type ChatTransport,
  type CreateUIMessage,
  type UIMessage,
  type UIMessageChunk,
  type UIMessagePart,
} from "ai";
import { z } from "zod";
import { options, resolveModelRole, type ProviderModelBilling, type ProviderModelReasoningEffort } from "@libs/options.ts";
import { withLock } from "@libs/lock.ts";
import { compactorPrompt } from "@harness/agent/prompts/compactor.ts";
import { resolveModel, resolveModelRef } from "@harness/agent/factory/provider-resolver.ts";
import { AGENTS, listAgents } from "@harness/agent/factory/agent/registry.ts";
import { listRules, type Rule } from "@harness/agent/rules.ts";
import { listCommands, listSkills, type Command } from "@harness/commands/index.ts";
import {
  computeCost,
  createLoop,
  type AiReasoningEffort,
  type Loop,
  type LoopConfig,
  type LoopMessage,
  type LoopMessageMetadata,
  type LoopUsage,
} from "@harness/agent/factory/loop/create-loop.ts";

//
// ── Persistence (formerly libs/sessions.ts) ─────────────────────────────────
//

/** Folder key: sanitized basename of the cwd. Empty/degenerate input -> "default". */
export function folderKeyFor(cwd: string): string {
  const raw = basename(cwd).toLowerCase();
  const key = raw.replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return key || "default";
}

/** 16-hex session id (first 16 chars of a sha1 over cwd/time/uuid). */
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
/** Per-session todo file (flow `todo` tool): `<folder>/<sessionId>/session-todo.json`. */
export const sessionTodoFilePath = (folderKey: string, sessionId: string): string =>
  join(sessionDir(folderKey), sessionId, "session-todo.json");
/** The `persitent` spelling is intentional (spec). */
export const persistentRoot = (): string => join(sessionsRoot(), "persitent");
export const persistentTurnFilePath = (timestamp: number, turn: number): string =>
  join(persistentRoot(), `${timestamp}-${turn}.jsonl`);

/** Tool-part states that are safe to re-send to the provider (mirrors AI SDK's
 * `ignoreIncompleteToolCalls` filter). Everything else — a dangling `call`,
 * `approval-requested`, ... — is stripped so an interrupted run can resume. */
const KEEP_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
  "approval-responded",
]);

export function sanitizeMessages<M extends UIMessage>(messages: M[]): M[] {
  return messages.flatMap((m) => {
    // Drop dangling tool parts (a `call`/`approval-requested` without a result)
    // so an interrupted run can be re-sent to the provider and re-rendered.
    // AI SDK tool parts are `tool-<name>` (typed tools) or `dynamic-tool`.
    const parts = m.parts.filter((part) => {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return true;
      // Preliminary outputs are mid-stream progress snapshots (streaming tools
      // like websearch); the final result is appended in a later message
      // version, so a partial one must never be kept as the tool result.
      if (isPreliminaryToolPart(part)) return false;
      return "state" in part && KEEP_TOOL_STATES.has(part.state ?? "");
    });
    return parts.length ? [{ ...m, parts }] : [];
  });
}

/** True when a tool part carries a streaming (non-final) output snapshot. */
function isPreliminaryToolPart(part: unknown): boolean {
  return typeof part === "object" && part !== null && "preliminary" in part && part.preliminary === true;
}

/**
 * True when an assistant message carries user-visible response content: a
 * non-empty answer text or a completed tool call. Streaming-only reasoning
 * does not count — interrupting during the thinking phase leaves nothing
 * worth keeping, so the whole turn can be erased.
 */
export function hasVisibleResponse(m: UIMessage): boolean {
  return m.parts.some((part) => {
    if (part.type === "text") return part.text.trim().length > 0;
    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
      if (isPreliminaryToolPart(part)) return false;
      return "state" in part && KEEP_TOOL_STATES.has(part.state ?? "");
    }
    return false;
  });
}

/**
 * Drop a prompt that never received a response: an interrupt before the
 * assistant produced an answer (or before its message even appeared) removes
 * the trailing assistant stub and the user prompt that triggered it, so the
 * erased turn leaves nothing behind.
 */
export function dropUnansweredPrompt<M extends UIMessage>(messages: M[]): M[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  if (last.role === "assistant" && !hasVisibleResponse(last)) {
    const prev = messages[messages.length - 2];
    if (prev?.role === "user") return messages.slice(0, -2);
    return messages.slice(0, -1);
  }
  // A trailing prompt whose assistant message was never created (cancelled
  // between submit and the first streamed chunk) is unanswered too.
  if (last.role === "user") return messages.slice(0, -1);
  return messages;
}

/** Tombstone line appended by `SessionSaver` when a previously written message
 * is removed from the in-memory conversation (e.g. an interrupted prompt with
 * no response). Append-only files can't delete, so the loader drops these. */
function isTombstone(value: unknown): value is { id: string } {
  if (typeof value !== "object" || value === null) return false;
  if (!("tombstone" in value) || value.tombstone !== true) return false;
  return "id" in value && typeof value.id === "string";
}

const sessionLineSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.unknown()),
});

type SessionLine = z.infer<typeof sessionLineSchema>;

/**
 * Load a session file, dedupe by message id (last occurrence's content at the
 * first occurrence's position — appends are idempotent so latest wins), then
 * sanitize. Returns null when the file is missing.
 */
export async function loadSession(
  folderKey: string,
  sessionId: string,
): Promise<UIMessage[] | null> {
  const filePath = sessionFilePath(folderKey, sessionId);
  let content: string;
  try {
    content = await withLock(filePath, () => readFile(filePath, "utf8"));
  } catch {
    return null;
  }

  const byId = new Map<string, { line: SessionLine; index: number }>();
  for (const [index, raw] of content.split("\n").entries()) {
    if (!raw.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      continue; // skip unparseable lines
    }
    // A tombstone erases a previously written message (removed mid-run, e.g.
    // an interrupted prompt with no response).
    if (isTombstone(value)) {
      byId.delete(value.id);
      continue;
    }
    let parsed: SessionLine;
    try {
      parsed = sessionLineSchema.parse(value);
    } catch {
      continue; // skip unparseable lines
    }
    const existing = byId.get(parsed.id);
    if (existing) existing.line = parsed; // keep first position, latest content
    else byId.set(parsed.id, { line: parsed, index });
  }

  const ordered = [...byId.values()]
    .sort((a, b) => a.index - b.index)
    // The parts union is too wide to re-validate per part; the renderer's
    // exhaustive switch is the safety net (see plan).
    .map((e) => e.line as unknown as UIMessage);
  return sanitizeMessages(ordered);
}

const previewLineSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.unknown()).optional(),
});

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || part.type !== "text") return false;
  if (!("text" in part) || typeof part.text !== "string") return false;
  return true;
}

/** First user text preview for a session file, truncated to 60 chars. */
function firstPromptPreview(content: string): string {
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let line: z.infer<typeof previewLineSchema>;
    try {
      line = previewLineSchema.parse(JSON.parse(raw));
    } catch {
      continue; // skip unparseable lines
    }
    if (line.role !== "user") continue;
    const text = (line.parts ?? []).find(isTextPart)?.text.trim();
    if (text) return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }
  return "(no text)";
}

export type SessionRow = { id: string; mtimeMs: number; firstPrompt: string };

/** List saved sessions for a folder, newest first. Best-effort: unreadable or
 * malformed files are skipped, a missing dir yields []. */
export async function listSessions(folderKey: string): Promise<SessionRow[]> {
  let names: string[];
  try {
    names = await readdir(sessionDir(folderKey));
  } catch {
    return [];
  }

  const rows: SessionRow[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.slice(0, -".jsonl".length);
    const filePath = join(sessionDir(folderKey), name);
    try {
      const [info, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
      rows.push({ id, mtimeMs: info.mtimeMs, firstPrompt: firstPromptPreview(content) });
    } catch {
      // skip unreadable files
    }
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Incremental JSONL session writer. `save` appends the latest serialized form
 * of each changed message under the file lock (idempotent for unchanged ones);
 * dedupe-on-load makes the appended duplicate versions safe. Writes are
 * serialized through an internal promise chain; `flush` awaits it (used on
 * unmount and by tests).
 */
export class SessionSaver {
  private lastWritten = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly filePath: string) {}

  save(messages: UIMessage[]): Promise<void> {
    if (!this.initialized) {
      mkdirSync(dirname(this.filePath), { recursive: true });
      this.initialized = true;
    }
    const currentIds = new Set(messages.map((m) => m.id));
    // Messages written before but gone now (interrupted prompt with no
    // response) are tombstoned so the loader drops them on resume.
    for (const id of [...this.lastWritten.keys()]) {
      if (currentIds.has(id)) continue;
      this.lastWritten.delete(id);
      const line = JSON.stringify({ id, tombstone: true });
      this.queue = this.queue.then(() =>
        withLock(this.filePath, () => appendFile(this.filePath, line + "\n")),
      );
    }
    for (const m of messages) {
      const json = JSON.stringify({ id: m.id, role: m.role, metadata: m.metadata, parts: m.parts });
      if (this.lastWritten.get(m.id) === json) continue;
      this.lastWritten.set(m.id, json);
      this.queue = this.queue.then(() =>
        withLock(this.filePath, () => appendFile(this.filePath, json + "\n")),
      );
    }
    return this.queue;
  }

  flush(): Promise<void> {
    return this.queue;
  }
}

//
// ── Compaction (formerly libs/compactor.ts) ─────────────────────────────────
//

/** Compaction triggers when used context reaches this share of the window. */
export const COMPACT_THRESHOLD = 0.8;

/** True when `contextUsed` tokens hit the compaction threshold of the window. */
export const shouldCompact = (contextUsed: number, contextWindow: number): boolean =>
  contextWindow > 0 && contextUsed / contextWindow >= COMPACT_THRESHOLD;

/** Tool-call lines are abbreviated to this length in the transcript. */
const MAX_TOOL_CHARS = 200;

/** Flatten any value to a short single-line string for the transcript. */
const abbreviate = (value: unknown): string => {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TOOL_CHARS ? `${flat.slice(0, MAX_TOOL_CHARS)}…` : flat;
};

type LoosePart = {
  type: string;
  text?: unknown;
  state?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};

const isToolPart = (part: LoosePart): boolean =>
  part.type === "dynamic-tool" || part.type.startsWith("tool-");

const toolPartName = (part: LoosePart): string =>
  part.type === "dynamic-tool" ? String(part.toolName ?? "unknown") : part.type.slice("tool-".length);

/**
 * Render a conversation as a plain-text transcript for the compactor model:
 * user/assistant text verbatim, tool calls one abbreviated line each,
 * reasoning dropped. Pure so it is directly unit-testable.
 */
export const serializeForCompaction = (messages: UIMessage[]): string =>
  messages
    .flatMap((m) => {
      if (m.role !== "user" && m.role !== "assistant") return [];
      const lines = (m.parts as LoosePart[]).flatMap((part): string[] => {
        if (part.type === "text") {
          const text = typeof part.text === "string" ? part.text.trim() : "";
          return text ? [`${m.role}: ${text}`] : [];
        }
        if (part.type === "reasoning") return []; // stream-only thinking adds nothing
        if (isToolPart(part)) {
          return [`tool ${toolPartName(part)} (${String(part.state ?? "unknown")}): ${abbreviate(part.input)} -> ${abbreviate(part.output ?? part.errorText)}`];
        }
        return [];
      });
      return lines;
    })
    .join("\n");

const CompactedSchema = z.object({
  summary: z.string().min(1),
});

export type CompactSessionParams = {
  messages: UIMessage[];
  modelKey: string;
  thinking?: ProviderModelReasoningEffort;
};

export type CompactResult = {
  /** The fresh conversation: a single user message carrying the summary. */
  messages: UIMessage[];
  summary: string;
};

/** Header wrapping the summary inside the fresh session's first message. */
export const compactedMessageText = (summary: string): string =>
  `[Session compacted — the earlier conversation was replaced by this summary.]\n\n${summary}`;

/**
 * Compact a conversation with a one-shot structured-output call. Uses the
 * currently running model (`modelKey`) with the compactor prompt; returns the
 * new (much shorter) message list. Throws on model failure — callers surface
 * the error and keep the un-compacted session.
 */
export async function compactSession({
  messages,
  modelKey,
  thinking,
}: CompactSessionParams): Promise<CompactResult> {
  const transcript = serializeForCompaction(messages);
  if (!transcript) throw new Error("Nothing to compact: the session has no content");
  const { model } = resolveModel(modelKey);
  const { output } = await generateText({
    model,
    output: Output.object({ schema: CompactedSchema }),
    system: compactorPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as AiReasoningEffort as any } : {}),
  });
  return {
    messages: [
      {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: compactedMessageText(output.summary) }],
      },
    ],
    summary: output.summary,
  };
}

//
// ── Session title (formerly libs/session-title.ts) ──────────────────────────
//

const MAX_PROMPT_CHARS = 2000;

/**
 * Generate a short session title with the `tiny` role model. Best-effort:
 * falls back to a truncated prompt when the model call fails or no model is
 * configured, so callers can treat the result as always-present.
 */
export async function generateSessionTitle(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  const fallback = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  if (!trimmed) return fallback;
  try {
    const { modelKey, thinking } = resolveModelRole(options.harness, "tiny");
    const { model } = resolveModel(modelKey);
    const { text } = await generateText({
      model,
      reasoning: thinking as AiReasoningEffort as any,
      prompt: [
        "Generate a concise session title (max 6 words) for a coding agent session.",
        "Reply with the title only: no quotes, no trailing punctuation, no explanation.",
        "",
        "User request:",
        trimmed.slice(0, MAX_PROMPT_CHARS),
      ].join("\n"),
    });
    const title = (text.split("\n")[0] ?? "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    return title || fallback;
  } catch {
    return fallback; // the prompt itself is a usable title
  }
}

//
// ── Chat core (formerly loop/chat.ts) ───────────────────────────────────────
//

/**
 * Headless `AbstractChat` implementation on top of the loop built by
 * `createLoop` (`ToolLoopAgent` + `DirectChatTransport`). Host frontends —
 * WhatsApp, cron, a future TUI — get the full chat contract (`sendMessage`,
 * `regenerate`, `stop`, `addToolOutput`, …) without an HTTP server or React:
 * every state mutation flows through a `ChatState` object that notifies an
 * `onChange` handler, the headless stand-in for the framework reactivity the
 * SDK's `useChat` would otherwise provide.
 */
class Chat extends AbstractChat<LoopMessage> {
  readonly loop: Loop;

  constructor({
    loop,
    ...init
  }: ChatInit<LoopMessage> & { state: ChatState<LoopMessage>; loop: Loop }) {
    super(init);
    this.loop = loop;
  }
}

/** Handler invoked after every chat-state mutation (status/error/messages). */
export type ChatChangeHandler = (state: ChatState<LoopMessage>) => void;

/**
 * Mutable, framework-free `ChatState`. `AbstractChat` mutates `status`,
 * `error`, and `messages` by plain assignment, so each is an accessor that
 * fires `onChange` after every write — push/pop/replace notify as well.
 */
export function createHeadlessChatState(
  messages: LoopMessage[] = [],
  onChange?: ChatChangeHandler,
): ChatState<LoopMessage> {
  let status: ChatStatus = "ready";
  let error: Error | undefined;
  let messageList: LoopMessage[] = messages;

  const notify = () => onChange?.(state);

  const state: ChatState<LoopMessage> = {
    get status() {
      return status;
    },
    set status(value) {
      status = value;
      notify();
    },
    get error() {
      return error;
    },
    set error(value) {
      error = value;
      notify();
    },
    get messages() {
      return messageList;
    },
    set messages(value) {
      messageList = value;
      notify();
    },
    pushMessage: (message) => {
      messageList.push(message);
      notify();
    },
    popMessage: () => {
      const popped = messageList.pop();
      notify();
      return popped;
    },
    replaceMessage: (index, message) => {
      messageList[index] = message;
      notify();
    },
    // Streaming reads the pre-run last message through this; clone so live
    // updates to the working copy never reach the history copy.
    snapshot: <T>(thing: T): T => structuredClone(thing),
  };

  return state;
}

//
// ── Session facade ──────────────────────────────────────────────────────────
//

/**
 * The curated session surface: chat state, the messaging contract, the live
 * config switchers, and the environment/usage introspection getters. Hosts
 * render/persist from `onChange` and read the getters — nothing else is
 * needed to run a conversation.
 */
export type Session = {
  /** Session id — also the chat id and the JSONL file name. */
  readonly id: string;
  readonly status: ChatStatus;
  readonly error: Error | undefined;
  readonly messages: LoopMessage[];
  readonly lastMessage: LoopMessage | undefined;
  /** The config the loop resolves per step: host config + switch overrides. */
  readonly config: LoopConfig;
  /** Discovered skills (`kind: "skill"` markdown commands). */
  readonly skills: Command[];
  /** Discovered workflows (`kind: "workflow"` markdown commands). */
  readonly workflows: Command[];
  /** Discovered project rules (the `<Rules>` prompt section). */
  readonly rules: Rule[];
  /** Registered agents available to `switchAgent`. */
  readonly agents: ReturnType<typeof listAgents>;
  /** Token usage + latency of the most recent run (undefined before the
   * first run settles). */
  readonly usage: SessionUsage | undefined;
  sendMessage: Chat["sendMessage"];
  regenerate: Chat["regenerate"];
  stop: Chat["stop"];
  /** Abort the in-flight run (keeping its generated tokens) and drop every
   * queued prompt — nothing further is sent. Unlike `stop()`, which only
   * cancels the current run and lets the queue continue. */
  abort: () => void;
  clearError: Chat["clearError"];
  addToolOutput: Chat["addToolOutput"];
  switchAgent: (agentId: string) => void;
  switchModel: (modelKey: string) => void;
  switchThinking: (thinking: ProviderModelReasoningEffort) => void;
  /** Enqueue a prompt. Dispatched one at a time: a queued prompt is sent
   * only after the current run has fully settled (immediately when idle). */
  queue: (prompt: SessionPrompt) => void;
  /** Subscribe to the UI message stream: yields every `UIMessageChunk` of
   * the run that starts after the call (text/reasoning/tool deltas, …) and
   * ends when that run settles. Chunks already emitted are not replayed.
   * Pipe into the SDK's `readUIMessageStream` for message snapshots. */
  stream: () => AsyncGenerator<UIMessageChunk>;
  /** Like `stream()`, but run through the SDK's `readUIMessageStream`: each
   * yield is a snapshot of the streaming assistant message with its parts
   * incrementally accumulated — the last snapshot is the finished message. */
  streamMessages: () => AsyncIterableStream<LoopMessage>;
  /** Send a prompt with priority: aborts the current streaming run (keeping
   * its generated tokens) and makes the steering prompt the next thing the
   * loop sees, ahead of any queued prompts. Resolves when its run settles. */
  steer: (prompt: SessionPrompt) => Promise<void>;
  /** Summarize the conversation with the current model and replace the
   * messages with the compacted result. Throws on model failure. */
  compact: () => Promise<CompactResult>;
  /** Await all pending persistence writes. */
  flush: () => Promise<void>;
};

export type CreateSessionInit = Omit<ChatInit<LoopMessage>, "transport"> & {
  /** Called after every chat-state mutation; hosts re-render/persist here. */
  onChange?: ChatChangeHandler;
};

/** Token usage + latency of the session's most recent run. */
export type SessionUsage = LoopUsage & {
  /** Output tokens per second, measured from the first token to the finish. */
  tps?: number;
  /** Milliseconds from submit to the first streamed token. */
  ttftMs?: number;
  /** USD cost derived from the model's billing metadata. */
  cost?: number;
};

/** A prompt accepted by `queue`/`steer`: plain text or a full UI message. */
export type SessionPrompt = string | CreateUIMessage<LoopMessage>;

type PendingPrompt = {
  message: CreateUIMessage<LoopMessage>;
  /** Resolved when this prompt's own run settles (used by `steer`). */
  onSettled?: () => void;
};

const toPromptMessage = (prompt: SessionPrompt): CreateUIMessage<LoopMessage> =>
  typeof prompt === "string"
    ? ({ parts: [{ type: "text", text: prompt }] } as CreateUIMessage<LoopMessage>)
    : prompt;

/**
 * Build a session: a chat over the loop config, persisted to
 * `<systemDir>/sessions/<folderKey>/<id>.jsonl` on every state change. The
 * chat id **is** the session id — flow tools (the `todo` list) and the JSONL
 * persistence both key on it.
 *
 * Passing `init.id` resumes an existing session: its saved messages are
 * loaded from disk (a fresh session starts under that id when the file does
 * not exist yet). Switch overrides (`switchAgent`/`switchModel`/
 * `switchThinking`) win over the host's `getConfig()` from the next step on;
 * `sessionId` always wins over everything.
 */
export async function createSession(getConfig: () => LoopConfig, init: CreateSessionInit = {}): Promise<Session> {
  const { onChange, messages, onFinish, id: sessionId, ...chatInit } = init;
  const id = sessionId ?? generateSessionId();
  const initialMessages =
    messages
      ?? (sessionId ? ((await loadSession(folderKeyFor(options.app.cwd), id)) as LoopMessage[]) : undefined);

  const overrides: Partial<LoopConfig> = {};
  const effectiveConfig = (): LoopConfig => ({ ...getConfig(), ...overrides, sessionId: id });

  const loop = createLoop(effectiveConfig);

  const saver = new SessionSaver(sessionFilePath(folderKeyFor(options.app.cwd), id));

  // Chunk broadcast: the loop's transport is wrapped so every UIMessageChunk
  // of a run is forwarded to `stream()` subscribers on its way into the chat.
  const streamListeners = new Set<(chunk: UIMessageChunk) => void>();
  const runEndListeners = new Set<() => void>();
  const transport: ChatTransport<LoopMessage> = {
    sendMessages: async (options) => {
      const upstream = await loop.transport.sendMessages(options);
      return upstream.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          transform(chunk, controller) {
            for (const listener of streamListeners) listener(chunk);
            controller.enqueue(chunk);
          },
        }),
      );
    },
    reconnectToStream: (options) => loop.transport.reconnectToStream(options),
  };

  // Queued prompts drain strictly one at a time: a prompt is sent only when
  // the previous run has fully settled — every loop step done, status back
  // out of submitted/streaming. The drain is (re)triggered whenever a run
  // settles (the wrapped `onFinish` below) or a prompt is enqueued; the
  // `draining` flag keeps a single dispatcher so sends never overlap.
  const pendingPrompts: PendingPrompt[] = [];
  let draining = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pendingPrompts.length > 0 && chat.status !== "submitted" && chat.status !== "streaming") {
        const item = pendingPrompts.shift()!;
        try {
          await chat.sendMessage(item.message);
        } finally {
          item.onSettled?.();
        }
      }
    } finally {
      draining = false;
    }
  };

  // Usage timing: `submitted` marks the run start, the first `streaming`
  // write marks the first token; the wrapped `onFinish` below turns them
  // into TTFT/TPS alongside the token usage the loop attached to the
  // finished message's metadata.
  let runStart: number | undefined;
  let firstTokenAt: number | undefined;
  let lastUsage: SessionUsage | undefined;

  const chat = new Chat({
    ...chatInit,
    id,
    transport,
    state: createHeadlessChatState(initialMessages ?? [], (state) => {
      if (state.status === "submitted") {
        runStart = Date.now();
        firstTokenAt = undefined;
      } else if (state.status === "streaming" && firstTokenAt === undefined) {
        firstTokenAt = Date.now();
      }
      onChange?.(state);
      // Best-effort persistence: a failed write must never crash the host.
      saver.save(state.messages).catch((error) => {
        console.error("picobu: session save failed:", error);
      });
    }),
    onFinish: (options) => {
      const meta = options.message.metadata as LoopMessageMetadata | undefined;
      const usage = meta?.usage;
      let billing: ProviderModelBilling | undefined;
      try {
        billing = resolveModelRef(effectiveConfig().modelKey).modelMeta.billing;
      } catch {
        billing = undefined; // unconfigured model — cost stays undefined
      }
      const ttftMs =
        firstTokenAt !== undefined && runStart !== undefined ? firstTokenAt - runStart : undefined;
      const tps =
        usage?.outputTokens && firstTokenAt !== undefined
          ? (usage.outputTokens / Math.max(1, Date.now() - firstTokenAt)) * 1000
          : undefined;
      lastUsage = {
        ...(usage ?? {}),
        ttftMs,
        tps,
        cost: usage ? computeCost(usage, billing) : undefined,
      };
      onFinish?.(options);
      // End any `stream()` generators: the run that produced their chunks has
      // settled. Fires before the drain so the next run's chunks belong to
      // the next stream subscription.
      for (const listener of runEndListeners) listener();
      // The run settled (completed, errored, or aborted) — the next queued
      // prompt, if any, may go out now.
      void drain();
    },
    loop,
  });

  // Subscribe to the chunk broadcast and yield the run's UIMessageChunks;
  // ends when the run settles (the wrapped onFinish signals runEndListeners).
  const streamChunks = (): AsyncGenerator<UIMessageChunk> =>
    (async function* () {
      const queue: UIMessageChunk[] = [];
      let notify: () => void = () => {};
      let ended = false;
      const listener = (chunk: UIMessageChunk) => {
        queue.push(chunk);
        notify();
      };
      const end = () => {
        ended = true;
        notify();
      };
      streamListeners.add(listener);
      runEndListeners.add(end);
      try {
        while (true) {
          if (queue.length === 0) {
            if (ended) return;
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
          }
          const chunk = queue.shift();
          if (chunk) yield chunk;
        }
      } finally {
        streamListeners.delete(listener);
        runEndListeners.delete(end);
      }
    })();

  return {
    id,
    get status() {
      return chat.status;
    },
    get error() {
      return chat.error;
    },
    get messages() {
      return chat.messages;
    },
    get lastMessage() {
      return chat.messages[chat.messages.length - 1];
    },
    get config() {
      return effectiveConfig();
    },
    get skills() {
      return listSkills();
    },
    get workflows() {
      return listCommands().filter((c) => c.kind === "workflow");
    },
    get rules() {
      return listRules();
    },
    get agents() {
      return listAgents();
    },
    get usage() {
      return lastUsage;
    },
    sendMessage: (message, requestOptions) => chat.sendMessage(message, requestOptions),
    regenerate: (options) => chat.regenerate(options),
    stop: () => chat.stop(),
    abort: () => {
      // Drop everything queued; pending steer/waiter promises resolve now —
      // including an in-flight drain item's waiter via its own finally.
      const pending = pendingPrompts.splice(0);
      for (const item of pending) item.onSettled?.();
      if (chat.status === "submitted" || chat.status === "streaming") {
        // Abort the run; its settle fires onFinish, which ends the stream
        // generators and re-drains — a no-op with the queue now empty.
        void chat.stop();
      }
    },
    clearError: () => chat.clearError(),
    addToolOutput: (options) => chat.addToolOutput(options),
    switchAgent: (agentId) => {
      if (!AGENTS[agentId]) throw new Error(`Unknown agent "${agentId}". Known agents: ${Object.keys(AGENTS).join(", ")}`);
      overrides.agentId = agentId;
    },
    switchModel: (modelKey) => {
      // resolveModelRef falls back to the first configured provider for
      // unknown ids — reject unless the resolution matched the key exactly.
      const ref = resolveModelRef(modelKey);
      if (`${ref.provider.id}/${ref.modelId}` !== modelKey) {
        throw new Error(`Unknown model "${modelKey}".`);
      }
      overrides.modelKey = modelKey;
    },
    switchThinking: (thinking) => {
      overrides.thinking = thinking;
    },
    queue: (prompt) => {
      pendingPrompts.push({ message: toPromptMessage(prompt) });
      void drain();
    },
    stream: streamChunks,
    streamMessages: () => {
      // One subscription for the whole snapshot stream: the generator buffers
      // chunks between pulls. The seed message gives the reconstructed
      // message a stable id (the SDK defaults to "" without it).
      const chunks = streamChunks();
      return readUIMessageStream<LoopMessage>({
        message: { id: generateId(), role: "assistant", parts: [] } as LoopMessage,
        stream: new ReadableStream<UIMessageChunk>({
          async pull(controller) {
            const { done, value } = await chunks.next();
            if (done) controller.close();
            else controller.enqueue(value);
          },
        }),
        // Error chunks are already formatted by the transport; keep the
        // snapshot stream alive so it ends with the run.
        terminateOnError: false,
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      });
    },
    steer: (prompt) =>
      new Promise<void>((resolve) => {
        // Jump the queue: the steering prompt is the next thing the loop sees.
        pendingPrompts.unshift({ message: toPromptMessage(prompt), onSettled: resolve });
        if (chat.status === "submitted" || chat.status === "streaming") {
          // Abort the in-flight run (tokens are kept); its settle fires the
          // wrapped `onFinish`, which drains — the steering prompt goes out
          // as soon as the abort has settled.
          void chat.stop();
        } else {
          void drain();
        }
      }),
    compact: async () => {
      const config = effectiveConfig();
      const result = await compactSession({
        messages: chat.messages,
        modelKey: config.modelKey,
        thinking: config.thinking,
      });
      chat.messages = result.messages as LoopMessage[];
      return result;
    },
    flush: () => saver.flush(),
  };
}
