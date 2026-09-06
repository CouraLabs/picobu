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
} from "ai";
import { z } from "zod";
import { options, resolveModelRole, type ProviderModelBilling, type ProviderModelReasoningEffort } from "@config/options.ts";
import { withLock } from "@shared/lock.ts";
import { compactorPrompt } from "@agent/prompts/compactor.ts";
import { resolveModel, resolveModelRef } from "@agent/model/resolver.ts";
import { AGENTS, listAgents } from "@agent/agents/registry.ts";
import { listRules, type Rule } from "@agent/rules/rules.ts";
import { listCommands, listSkills, type Command } from "@agent/commands/index.ts";
import {
  computeCost,
  computeCostSplit,
  createLoop,
  type AiReasoningEffort,
  type Loop,
  type LoopConfig,
  type LoopMessage,
  type LoopMessageMetadata,
  type LoopUsage,
} from "@agent/loop/create-loop.ts";
import {
  addToTotals,
  emptyTotals,
  isWaiting,
  readSessionMeta,
  updateSessionMeta,
  writeSessionMeta,
  type CostDetail,
  type SessionMeta,
  type SessionState,
  type SessionTotals,
} from "@agent/sessions/session-meta.ts";
import { CheckpointStore, checkpointsPath, type UndoResult } from "@agent/sessions/checkpoints.ts";
import { summarizeSession, type SummarizeResult } from "@agent/prompts/summarizer.ts";






export function folderKeyFor(cwd: string): string {
  const raw = basename(cwd).toLowerCase();
  const key = raw.replace(/[^a-z0-9._-]/g, "-").replace(/^-+|-+$/g, "");
  return key || "default";
}


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
export const sessionTodoFilePath = (folderKey: string, sessionId: string): string =>
  join(sessionDir(folderKey), sessionId, "session-todo.json");
export const persistentRoot = (): string => join(sessionsRoot(), "persitent");
export const persistentTurnFilePath = (timestamp: number, turn: number): string =>
  join(persistentRoot(), `${timestamp}-${turn}.jsonl`);


const KEEP_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
  "approval-responded",
]);
export function sanitizeMessages<M extends UIMessage>(messages: M[]): M[] {
  return messages.flatMap((m) => {
    
    
    
    const parts = m.parts.filter((part) => {
      if (part.type !== "dynamic-tool" && !part.type.startsWith("tool-")) return true;
      
      
      
      if (isPreliminaryToolPart(part)) return false;
      return "state" in part && KEEP_TOOL_STATES.has(part.state ?? "");
    });
    return parts.length ? [{ ...m, parts }] : [];
  });
}


function isPreliminaryToolPart(part: unknown): boolean {
  return typeof part === "object" && part !== null && "preliminary" in part && part.preliminary === true;
}


export function stripUnreplayableReasoning<M extends UIMessage>(messages: M[]): M[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    let changed = false;
    const parts = m.parts.filter((part) => {
      if (part.type !== "reasoning") return true;
      const meta = (
        part as { providerMetadata?: { anthropic?: { signature?: unknown; redactedData?: unknown } } }
      ).providerMetadata;
      const replayable = Boolean(meta?.anthropic?.signature || meta?.anthropic?.redactedData);
      if (!replayable) changed = true;
      return replayable;
    });
    return changed ? { ...m, parts } : m;
  });
}


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


export function dropUnansweredPrompt<M extends UIMessage>(messages: M[]): M[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  if (last.role === "assistant" && !hasVisibleResponse(last)) {
    const prev = messages[messages.length - 2];
    if (prev?.role === "user") return messages.slice(0, -2);
    return messages.slice(0, -1);
  }
  
  
  if (last.role === "user") return messages.slice(0, -1);
  return messages;
}


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
      continue; 
    }
    
    
    if (isTombstone(value)) {
      byId.delete(value.id);
      continue;
    }
    let parsed: SessionLine;
    try {
      parsed = sessionLineSchema.parse(value);
    } catch {
      continue; 
    }
    const existing = byId.get(parsed.id);
    if (existing) existing.line = parsed; 
    else byId.set(parsed.id, { line: parsed, index });
  }
  const ordered = [...byId.values()]
    .sort((a, b) => a.index - b.index)
    .map((e) => e.line as unknown as UIMessage);
  return sanitizeMessages(ordered);
}
const previewLineSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  metadata: z.unknown().optional(),
  parts: z.array(z.unknown()).optional(),
});
function isTextPart(part: unknown): part is { type: "text"; text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || part.type !== "text") return false;
  if (!("text" in part) || typeof part.text !== "string") return false;
  return true;
}


function firstPromptPreview(content: string): string {
  for (const raw of content.split("\n")) {
    if (!raw.trim()) continue;
    let line: z.infer<typeof previewLineSchema>;
    try {
      line = previewLineSchema.parse(JSON.parse(raw));
    } catch {
      continue; 
    }
    if (line.role !== "user") continue;
    const meta = line.metadata as { compaction?: unknown } | undefined;
    if (meta?.compaction) continue;
    const text = (line.parts ?? []).find(isTextPart)?.text.trim();
    if (!text) continue;
    
    
    if (text.startsWith(COMPACTION_HEADER)) continue;
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  }
  return "(no text)";
}
export type SessionRow = { id: string; mtimeMs: number; firstPrompt: string };


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
    }
  }
  return rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
}


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






export const COMPACT_THRESHOLD = 0.8;


export const shouldCompact = (contextUsed: number, contextWindow: number): boolean =>
  contextWindow > 0 && contextUsed / contextWindow >= COMPACT_THRESHOLD;


const MAX_TOOL_CHARS = 200;


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


export const serializeForCompaction = (messages: UIMessage[]): string =>
  messages
    .flatMap((m) => {
      if (m.role !== "user" && m.role !== "assistant") return [];
      const lines = (m.parts as LoosePart[]).flatMap((part): string[] => {
        if (part.type === "text") {
          const text = typeof part.text === "string" ? part.text.trim() : "";
          return text ? [`${m.role}: ${text}`] : [];
        }
        if (part.type === "reasoning") return []; 
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
  summary: string;
  cutMessageId: string;
  forkedSessionId?: string;
};


export const isCompactionCut = (message: UIMessage | undefined): boolean => {
  const meta = message?.metadata as LoopMessageMetadata | undefined;
  return meta?.compaction !== undefined;
};


export function messagesForLlm<M extends UIMessage>(messages: M[]): M[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isCompactionCut(messages[i])) continue;
    return messages.slice(i);
  }
  return messages;
}


const COMPACTION_HEADER = "[Session compacted";


export const compactedMessageText = (summary: string): string =>
  `${COMPACTION_HEADER} — the earlier conversation was replaced by this summary.]\n\n${summary}`;


export async function compactSession({
  messages,
  modelKey,
  thinking,
}: CompactSessionParams): Promise<{ summary: string }> {
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
  return { summary: output.summary };
}





const MAX_PROMPT_CHARS = 2000;


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
        "Generate a concise thread title for conversation retrieval.",
        "Output MUST be a single line, ≤50 chars, no explanations.",
        "Match input language and maintain natural grammar.",
        "Focus on user intent/topic; omit 'a', 'an', 'the', 'this', 'my'.",
        "Preserve exact technical terms, numbers, filenames, and HTTP codes.",
        "For files, focus on intended action rather than sharing.",
        "For brief/casual greetings, output intent (e.g., 'Greeting', 'Light chat').",
        "Never use tools, answer questions, or include words like 'summarizing'.",
        "Examples: 'refactor user service' -> 'Refactoring user service', '@App.tsx add dark mode' -> 'Dark mode toggle in App'.",
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
    return fallback; 
  }
}






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


export type ChatChangeHandler = (state: ChatState<LoopMessage>) => void;


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
    
    
    snapshot: <T>(thing: T): T => structuredClone(thing),
  };
  return state;
}






export type Session = {
  readonly id: string;
  readonly status: ChatStatus;
  readonly error: Error | undefined;
  readonly messages: LoopMessage[];
  readonly lastMessage: LoopMessage | undefined;
  readonly config: LoopConfig;
  readonly skills: Command[];
  readonly workflows: Command[];
  readonly rules: Rule[];
  readonly agents: ReturnType<typeof listAgents>;
  readonly mcp: {
    servers: () => Promise<import("@integrations/mcp/client.ts").McpServerSnapshot[]>;
    tools: () => Promise<string[]>;
    refresh: () => Promise<void>;
  };
  readonly usage: SessionUsage | undefined;
  readonly totals: SessionTotals;
  readonly state: SessionState;
  summarize: () => Promise<SummarizeResult>;
  undo: () => Promise<UndoResult>;
  redo: () => Promise<UndoResult>;
  addUsage: (detail: CostDetail) => void;
  sendMessage: Chat["sendMessage"];
  regenerate: Chat["regenerate"];
  stop: Chat["stop"];
  abort: () => void;
  clearError: Chat["clearError"];
  addToolOutput: Chat["addToolOutput"];
  switchAgent: (agentId: string) => void;
  switchModel: (modelKey: string) => void;
  switchThinking: (thinking: ProviderModelReasoningEffort) => void;
  queue: (prompt: SessionPrompt) => void;
  stream: () => AsyncGenerator<UIMessageChunk>;
  streamMessages: () => AsyncIterableStream<LoopMessage>;
  steer: (prompt: SessionPrompt) => Promise<void>;
  compact: (opts?: { fork?: boolean }) => Promise<CompactResult>;
  uncompact: () => void;
  flush: () => Promise<void>;
  close: () => Promise<void>;
};
export type CreateSessionInit = Omit<ChatInit<LoopMessage>, "transport"> & {
  onChange?: ChatChangeHandler;
  meta?: {
    cwd?: string;
    parentSessionId?: string;
    title?: string;
    forkHost?: () => Promise<string>;
  };
  autoCompact?: boolean;
  forkOnCompact?: boolean;
};


export type SessionUsage = LoopUsage & {
  tps?: number;
  ttftMs?: number;
  cost?: number;
};


export type SessionPrompt = string | CreateUIMessage<LoopMessage>;
type PendingPrompt = {
  message: CreateUIMessage<LoopMessage>;
  onSettled?: () => void;
};


export const toPromptMessage = (prompt: SessionPrompt): CreateUIMessage<LoopMessage> =>
  typeof prompt === "string"
    ? ({ parts: [{ type: "text", text: prompt }] } as CreateUIMessage<LoopMessage>)
    : prompt;


export async function createSession(getConfig: () => LoopConfig, init: CreateSessionInit = {}): Promise<Session> {
  const { onChange, messages, onFinish, id: sessionId, meta: metaInit, autoCompact, forkOnCompact, ...chatInit } = init;
  const forkHost = metaInit?.forkHost;
  const id = sessionId ?? generateSessionId();
  
  
  
  const cwd = metaInit?.cwd ?? getConfig().cwd ?? options.app.cwd;
  const folderKey = folderKeyFor(cwd);
  const initialMessages =
    messages
      ?? (sessionId ? ((await loadSession(folderKey, id)) as LoopMessage[]) : undefined);
  const overrides: Partial<LoopConfig> = {};
  const effectiveConfig = (): LoopConfig => ({ ...getConfig(), ...overrides, sessionId: id });
  const loop = createLoop(effectiveConfig);
  const saver = new SessionSaver(sessionFilePath(folderKey, id));

  
  
  let meta: SessionMeta | null = await readSessionMeta(folderKey, id);
  if (!meta) {
    meta = {
      id,
      title: metaInit?.title,
      state: "finished",
      parentSessionId: metaInit?.parentSessionId,
      cwd,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelKey: effectiveConfig().modelKey,
    };
    await writeSessionMeta(folderKey, id, meta);
  }
  const persistMeta = (patch: Partial<Omit<SessionMeta, "id">>): void => {
    void updateSessionMeta(folderKey, id, patch).catch((error) => {
      console.error("picobu: session meta persist failed:", error);
    });
  };

  
  
  let totals: SessionTotals = meta.totals ?? emptyTotals();

  
  
  const streamListeners = new Set<(chunk: UIMessageChunk) => void>();
  const runEndListeners = new Set<() => void>();
  const transport: ChatTransport<LoopMessage> = {
    sendMessages: async (options) => {
      
      
      
      
      
      const upstream = await loop.transport.sendMessages({
        ...options,
        messages: stripUnreplayableReasoning(messagesForLlm(options.messages)),
      });
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

  
  
  
  
  
  const pendingPrompts: PendingPrompt[] = [];
  let draining = false;
  let compaction: Promise<void> | undefined;
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pendingPrompts.length > 0 && !isRunning()) {
        
        
        const pendingCompaction = compaction;
        if (pendingCompaction) await pendingCompaction;
        if (isRunning()) break;
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

  
  
  
  
  let runStart: number | undefined;
  let firstTokenAt: number | undefined;
  let lastUsage: SessionUsage | undefined;

  
  
  
  
  let aborting = false;

  
  let lastDerivedState: SessionState | undefined;
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
      
      
      
      const derived: SessionState =
        state.status === "submitted" || state.status === "streaming"
          ? "running"
          : state.error
            ? "error"
            : isWaiting(state.messages)
              ? "waiting"
              : "finished";
      if (derived !== lastDerivedState) {
        lastDerivedState = derived;
        persistMeta({ state: derived });
      }
      onChange?.(state);
      saver.save(state.messages).catch((error) => {
        console.error("picobu: session save failed:", error);
      });
    }),
    onFinish: (options) => {
      
      
      
      
      const wasAborting = aborting;
      if (aborting) {
        aborting = false;
        const kept = dropUnansweredPrompt(chat.messages);
        if (kept.length !== chat.messages.length) chat.messages = kept;
      }
      const meta = options.message.metadata as LoopMessageMetadata | undefined;
      const usage = meta?.usage;
      let billing: ProviderModelBilling | undefined;
      try {
        billing = resolveModelRef(effectiveConfig().modelKey).modelMeta.billing;
      } catch {
        billing = undefined; 
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
      
      
      
      if (usage) {
        const split = computeCostSplit(usage, billing);
        totals = addToTotals(totals, {
          source: "run",
          modelKey: effectiveConfig().modelKey,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          cacheReadTokens: usage.cacheReadTokens ?? 0,
          cacheWriteTokens: usage.cacheWriteTokens ?? 0,
          cost: lastUsage.cost,
          ...(split ?? {}),
        });
        persistMeta({ totals });
      }
      onFinish?.(options);
      
      
      
      for (const listener of runEndListeners) listener();
      
      
      
      if (autoCompact && !wasAborting && !chat.error && shouldAutoCompact(usage)) {
        void runAutoCompact();
      } else {
        
        
        void drain();
      }
    },
    loop,
  });
  const markAborting = (): void => {
    if (chat.status === "submitted" || chat.status === "streaming") aborting = true;
  };

  
  const isRunning = (): boolean => chat.status === "submitted" || chat.status === "streaming";

  
  let compacting = false;

  
  const compactInternal = async ({ fork }: { fork?: boolean } = {}): Promise<CompactResult> => {
    if (compacting) throw new Error("Compaction already in progress");
    if (isRunning()) {
      throw new Error("Cannot compact while a run is in progress");
    }
    if (isWaiting(chat.messages)) {
      
      
      throw new Error("Cannot compact while waiting on a flow tool");
    }
    const config = effectiveConfig();
    if (fork && !forkHost) throw new Error("Forking requires a session manager");
    compacting = true;
    const run = (async () => {
      try {
        const { summary } = await compactSession({
          messages: chat.messages,
          modelKey: config.modelKey,
          thinking: config.thinking,
        });
        
        
        if (isRunning()) {
          throw new Error("Cannot compact while a run is in progress");
        }
        
        
        
        
        
        
        const forkedSessionId = fork ? await forkHost!() : undefined;
        
        
        if (isRunning()) {
          throw new Error("Cannot compact while a run is in progress");
        }
        const text = compactedMessageText(summary);
        if (fork) {
          
          
          
          const reset: LoopMessage = {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text }],
          };
          chat.messages = [reset];
          return { summary, cutMessageId: reset.id, forkedSessionId };
        }
        const cut: LoopMessage = {
          id: randomUUID(),
          role: "user",
          metadata: {
            compaction: {
              summary,
              compactedMessageIds: chat.messages.map((m) => m.id),
              createdAt: Date.now(),
            },
          },
          parts: [{ type: "text", text }],
        };
        chat.messages = [...chat.messages, cut];
        return { summary, cutMessageId: cut.id, forkedSessionId };
      } finally {
        compacting = false;
      }
    })();
    
    
    const settled = run.then(() => {}, () => {});
    compaction = settled;
    settled.then(() => {
      if (compaction === settled) compaction = undefined;
    });
    return run;
  };

  
  const shouldAutoCompact = (usage: LoopUsage | undefined): boolean => {
    if (!usage) return false;
    if (effectiveConfig().subagent) return false; 
    
    
    
    if (isCompactionCut(chat.messages[chat.messages.length - 1])) return false;
    if (isWaiting(chat.messages)) return false;
    let contextWindow = 0;
    try {
      contextWindow = resolveModelRef(effectiveConfig().modelKey).modelMeta.context;
    } catch {
      return false; 
    }
    return shouldCompact(usage.inputTokens ?? 0, contextWindow);
  };

  
  
  
  const runAutoCompact = async (): Promise<void> => {
    try {
      await compactInternal({ fork: forkOnCompact });
    } catch (error) {
      console.error("picobu: auto-compaction failed:", error);
    } finally {
      void drain();
    }
  };

  
  const currentState = (): SessionState =>
    chat.status === "submitted" || chat.status === "streaming"
      ? "running"
      : chat.error
        ? "error"
        : isWaiting(chat.messages)
          ? "waiting"
          : "finished";

  
  
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
    get mcp() {
      return {
        servers: () => loop.mcp.snapshot(),
        tools: async () => Object.keys(await loop.mcp.tools()),
        refresh: () => loop.mcp.refresh(),
      };
    },
    get usage() {
      return lastUsage;
    },
    get totals() {
      return totals;
    },
    get state(): SessionState {
      return currentState();
    },
    summarize: async (): Promise<SummarizeResult> => {
      const config = effectiveConfig();
      return summarizeSession({
        messages: chat.messages,
        modelKey: config.modelKey,
        thinking: config.thinking,
      });
    },
    undo: () => {
      const state = currentState();
      if (state === "running") throw new Error("Cannot undo while a run is in progress");
      if (state === "error") throw new Error("Cannot undo while the session is in the error state");
      return new CheckpointStore(checkpointsPath(folderKey, id)).undo();
    },
    redo: () => {
      const state = currentState();
      if (state === "running") throw new Error("Cannot redo while a run is in progress");
      if (state === "error") throw new Error("Cannot redo while the session is in the error state");
      return new CheckpointStore(checkpointsPath(folderKey, id)).redo();
    },
    addUsage: (detail: CostDetail) => {
      totals = addToTotals(totals, detail);
      persistMeta({ totals });
    },
    sendMessage: (message, requestOptions) => chat.sendMessage(message, requestOptions),
    regenerate: (options) => chat.regenerate(options),
    stop: () => {
      markAborting();
      return chat.stop();
    },
    abort: () => {
      
      
      const pending = pendingPrompts.splice(0);
      for (const item of pending) item.onSettled?.();
      if (chat.status === "submitted" || chat.status === "streaming") {
        
        
        
        markAborting();
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
        
        
        terminateOnError: false,
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      });
    },
    steer: (prompt) =>
      new Promise<void>((resolve) => {
        pendingPrompts.unshift({ message: toPromptMessage(prompt), onSettled: resolve });
        if (chat.status === "submitted" || chat.status === "streaming") {
          
          
          
          markAborting();
          void chat.stop();
        } else {
          void drain();
        }
      }),
    compact: (opts) => compactInternal(opts ?? {}),
    uncompact: () => {
      if (isRunning()) {
        throw new Error("Cannot uncompact while a run is in progress");
      }
      for (let i = chat.messages.length - 1; i >= 0; i--) {
        if (!isCompactionCut(chat.messages[i])) continue;
        chat.messages = chat.messages.filter((_, index) => index !== i);
        return;
      }
      throw new Error("Nothing to uncompact: the session has no compaction cut");
    },
    flush: () => saver.flush(),
    close: async () => {
      const pending = pendingPrompts.splice(0);
      for (const item of pending) item.onSettled?.();
      if (chat.status === "submitted" || chat.status === "streaming") {
        markAborting();
        try {
          await chat.stop();
        } catch {
        }
      }
      await saver.flush();
      await loop.mcp.close();
    },
  };
}
