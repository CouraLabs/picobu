import { randomUUID } from "node:crypto";
import {
  generateId,
  readUIMessageStream,
  type AsyncIterableStream,
  type ChatInit,
  type ChatStatus,
  type ChatTransport,
  type CreateUIMessage,
  type UIMessageChunk,
} from "ai";
import {
  createLoop,
  type Loop,
  type LoopConfig,
  type LoopMessage,
  type LoopMessageMetadata,
} from "@agent/loop/create-loop.ts";
import { computeCost, computeCostSplit, type LoopUsage } from "@agent/model/cost.ts";
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
import { resolveModelRef } from "@agent/model/resolver.ts";
import { options, type ProviderModelBilling, type ProviderModelReasoningEffort } from "@config/options.ts";
import { AGENTS, listAgents } from "@agent/agents/registry.ts";
import { listRules, type Rule } from "@agent/rules/rules.ts";
import { listCommands, listSkills, type Command } from "@agent/commands/index.ts";
import { checkpointsPath, CheckpointStore, type UndoResult } from "@agent/sessions/checkpoints.ts";
import { summarizeSession, type SummarizeResult } from "@agent/prompts/summarizer.ts";
import { dropUnansweredPrompt, stripUnreplayableReasoning } from "@agent/sessions/session-messages.ts";
import {
  buildPlanHandoffCut,
  compactedMessageText,
  compactSession,
  isCompactionCut,
  messagesForLlm,
  shouldCompact,
  type CompactResult,
} from "@agent/sessions/session-compaction.ts";
import { loadSession, SessionSaver } from "@agent/sessions/session-store.ts";
import { folderKeyFor, generateSessionId, sessionFilePath } from "@agent/sessions/session-paths.ts";
import { Chat, createHeadlessChatState, type ChatChangeHandler } from "@agent/sessions/session-headless-chat.ts";

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

export type FlowToolName = "ask" | "plan-write";
export type FlowToolOutput = { status: string; message: string };
export type RespondFlowToolInput = {
  tool: FlowToolName;
  toolCallId: string;
  output: FlowToolOutput;
};

type LooseFlowPart = {
  type?: unknown;
  toolName?: unknown;
  toolCallId?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
};

const flowToolPartName = (part: LooseFlowPart): string | undefined => {
  if (part.type === "dynamic-tool") return typeof part.toolName === "string" ? part.toolName : undefined;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  return undefined;
};

const findFlowPart = (
  messages: LoopMessage[],
  tool: string,
  toolCallId: string,
): { message: LoopMessage; part: LooseFlowPart } | undefined => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    for (const raw of message.parts ?? []) {
      const part = raw as LooseFlowPart;
      if (flowToolPartName(part) !== tool) continue;
      if (part.toolCallId !== toolCallId) continue;
      return { message, part };
    }
  }
  return undefined;
};

const flowOutputStatus = (part: LooseFlowPart): string | undefined => {
  const output = part.output as { status?: unknown } | undefined;
  return typeof output?.status === "string" ? output.status : undefined;
};

export const toPromptMessage = (prompt: SessionPrompt): CreateUIMessage<LoopMessage> =>
  typeof prompt === "string"
    ? ({ parts: [{ type: "text", text: prompt }] } as CreateUIMessage<LoopMessage>)
    : prompt;

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
  /** Drops every message after the given one from the context and persists the truncation. */
  revertToMessage: (messageId: string) => void;
  addUsage: (detail: CostDetail) => void;
  sendMessage: Chat["sendMessage"];
  regenerate: Chat["regenerate"];
  stop: Chat["stop"];
  abort: () => void;
  clearError: Chat["clearError"];
  addToolOutput: Chat["addToolOutput"];
  respondFlowTool: (input: RespondFlowToolInput) => Promise<void>;
  setPlanHandoffCompact: (compact: boolean) => void;
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
  /** Static loop config or a live getter, re-evaluated on every run. */
  config: LoopConfig | (() => LoopConfig);
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

const deriveState = (chat: {
  status: ChatStatus;
  error: Error | undefined;
  messages: LoopMessage[];
}): SessionState =>
  chat.status === "submitted" || chat.status === "streaming"
    ? "running"
    : chat.error
      ? "error"
      : isWaiting(chat.messages)
        ? "waiting"
        : "finished";

export async function createSession(init: CreateSessionInit): Promise<Session> {
  const {
    config: configInit,
    onChange,
    messages,
    onFinish,
    id: sessionId,
    meta: metaInit,
    autoCompact,
    forkOnCompact,
    ...chatInit
  } = init;
  const forkHost = metaInit?.forkHost;
  const getConfig = typeof configInit === "function" ? configInit : () => configInit;
  const id = sessionId ?? generateSessionId();
  const cwd = metaInit?.cwd ?? getConfig().cwd ?? options.app.cwd;
  const folderKey = folderKeyFor(cwd);
  const initialMessages = messages ?? (sessionId ? ((await loadSession(folderKey, id)) as LoopMessage[]) : undefined);
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
  let resumeOnce = false;
  let planHandoffOnce = false;
  let resuming = false;
  let planHandoffCompact = false;
  const consumedPlanExits = new Set<string>();
  const isRunning = (): boolean => chat.status === "submitted" || chat.status === "streaming";
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pendingPrompts.length > 0 && !isRunning()) {
        if (isWaiting(chat.messages)) break;
        const pendingCompaction = compaction;
        if (pendingCompaction) await pendingCompaction;
        if (isRunning()) break;
        if (isWaiting(chat.messages)) break;
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

  const settlePending = (): void => {
    const pending = pendingPrompts.splice(0);
    for (const item of pending) item.onSettled?.();
  };
  const markAborting = (): void => {
    if (isRunning()) aborting = true;
  };
  const requestStop = (): void => {
    markAborting();
    void chat.stop();
  };
  const assertNotRunning = (what: string): void => {
    if (isRunning()) throw new Error(`Cannot ${what} while a run is in progress`);
  };
  const assertEditable = (op: "undo" | "redo"): void => {
    assertNotRunning(op);
    if (chat.error) throw new Error(`Cannot ${op} while the session is in the error state`);
  };

  let runStart: number | undefined;
  let firstTokenAt: number | undefined;
  let lastUsage: SessionUsage | undefined;
  let aborting = false;
  let lastDerivedState: SessionState | undefined;
  const chat = new Chat({
    ...chatInit,
    sendAutomaticallyWhen: () => {
      if (resumeOnce) {
        resumeOnce = false;
        return true;
      }
      if (planHandoffOnce) {
        planHandoffOnce = false;
        return true;
      }
      return false;
    },
    id,
    transport,
    state: createHeadlessChatState(initialMessages ?? [], (state) => {
      if (state.status === "submitted") {
        runStart = Date.now();
        firstTokenAt = undefined;
      } else if (state.status === "streaming" && firstTokenAt === undefined) {
        firstTokenAt = Date.now();
      }
      if (resuming && state.status !== "ready") resuming = false;
      const derived = deriveState(chat);
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
      const finished = options.message as LoopMessage;
      const freshExits = (finished.parts ?? [])
        .map((p) => p as LooseFlowPart)
        .filter((p) => flowToolPartName(p) === "plan-exit" && p.state === "output-available")
        .map((p) => (typeof p.toolCallId === "string" ? p.toolCallId : undefined))
        .filter((id): id is string => !!id && !consumedPlanExits.has(id));
      for (const id of freshExits) consumedPlanExits.add(id);
      if (freshExits.length > 0) {
        overrides.agentId = "coder";
        resuming = true;
        if (planHandoffCompact) {
          const planPart = (finished.parts ?? []).map((p) => p as LooseFlowPart).find(
            (p) => flowToolPartName(p) === "plan-write" && flowOutputStatus(p) === "approved",
          );
          const planInput = planPart?.input as { plan?: unknown } | undefined;
          const planText = typeof planInput?.plan === "string" ? planInput.plan : undefined;
          const verdictText =
            typeof (planPart?.output as { message?: unknown } | undefined)?.message === "string"
              ? String((planPart?.output as { message: string }).message)
              : "";
          if (planText) {
            const cut = buildPlanHandoffCut({ messages: chat.messages, plan: planText, verdict: verdictText });
            chat.messages = [
              ...chat.messages,
              {
                id: randomUUID(),
                role: "user",
                metadata: {
                  compaction: {
                    summary: cut.summary,
                    compactedMessageIds: cut.compactedMessageIds,
                    createdAt: Date.now(),
                    kind: "plan-handoff",
                  },
                },
                parts: [{ type: "text", text: cut.text }],
              } as LoopMessage,
            ];
          }
        }
        planHandoffCompact = false;
        planHandoffOnce = true;
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

  let compacting = false;
  const compactInternal = async ({ fork }: { fork?: boolean } = {}): Promise<CompactResult> => {
    if (compacting) throw new Error("Compaction already in progress");
    assertNotRunning("compact");
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
        assertNotRunning("compact");
        const forkedSessionId = fork ? await forkHost!() : undefined;
        assertNotRunning("compact");
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
      return deriveState(chat);
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
      assertEditable("undo");
      return new CheckpointStore(checkpointsPath(folderKey, id)).undo();
    },
    redo: () => {
      assertEditable("redo");
      return new CheckpointStore(checkpointsPath(folderKey, id)).redo();
    },
    revertToMessage: (messageId) => {
      assertNotRunning("revert");
      const index = chat.messages.findIndex((m) => m.id === messageId);
      if (index < 0) throw new Error(`Unknown message "${messageId}"`);
      // Assigning the state notifies listeners, which persist the truncated
      // list through the SessionSaver.
      chat.messages = chat.messages.slice(0, index + 1);
    },
    addUsage: (detail: CostDetail) => {
      totals = addToTotals(totals, detail);
      persistMeta({ totals });
    },
    sendMessage: ((message, requestOptions) => {
      if (message !== undefined && (resuming || isWaiting(chat.messages))) {
        pendingPrompts.push({ message: toPromptMessage(message as SessionPrompt) });
        void drain();
        return Promise.resolve();
      }
      return chat.sendMessage(message, requestOptions);
    }) as Chat["sendMessage"],
    regenerate: (options) => chat.regenerate(options),
    stop: () => {
      markAborting();
      return chat.stop();
    },
    abort: () => {
      settlePending();
      if (isRunning()) requestStop();
    },
    clearError: () => chat.clearError(),
    addToolOutput: (options) => chat.addToolOutput(options),
    respondFlowTool: async ({ tool, toolCallId, output }) => {
      if (tool !== "ask" && tool !== "plan-write") throw new Error(`Unknown flow tool "${tool}"`);
      if (isRunning()) throw new Error("Cannot answer while a run is in progress");
      const last = chat.messages[chat.messages.length - 1];
      if (!last || last.role !== "assistant") throw new Error("No pending question to answer");
      const found = findFlowPart(chat.messages, tool, toolCallId);
      if (!found || found.message.id !== last.id) throw new Error("No pending question to answer");
      if (flowOutputStatus(found.part) !== "pending") throw new Error("This question was already answered");
      if (tool === "plan-write" && output.status !== "approved") planHandoffCompact = false;
      resumeOnce = true;
      resuming = true;
      try {
        await chat.addToolOutput({ tool: tool as never, toolCallId, output: output as never });
      } catch (error) {
        resumeOnce = false;
        resuming = false;
        throw error;
      }
    },
    setPlanHandoffCompact: (compact) => {
      planHandoffCompact = compact;
    },
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
            try {
              if (done) controller.close();
              else controller.enqueue(value);
            } catch (error) {
              // `ai`'s readUIMessageStream closes its controller in a
              // `.finally()` and can race with stream teardown (run stopped,
              // session closed); only that known-harmless case is swallowed.
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes("Controller is already closed")) return;
              throw error;
            }
          },
        }),
        terminateOnError: false,
        onError: (error) => (error instanceof Error ? error.message : String(error)),
      });
    },
    steer: (prompt) =>
      new Promise<void>((resolve) => {
        if (resuming || isWaiting(chat.messages)) {
          pendingPrompts.push({ message: toPromptMessage(prompt), onSettled: resolve });
          return;
        }
        pendingPrompts.unshift({ message: toPromptMessage(prompt), onSettled: resolve });
        if (isRunning()) {
          requestStop();
        } else {
          void drain();
        }
      }),
    compact: (opts) => compactInternal(opts ?? {}),
    uncompact: () => {
      assertNotRunning("uncompact");
      for (let i = chat.messages.length - 1; i >= 0; i--) {
        if (!isCompactionCut(chat.messages[i])) continue;
        chat.messages = chat.messages.filter((_, index) => index !== i);
        return;
      }
      throw new Error("Nothing to uncompact: the session has no compaction cut");
    },
    flush: () => saver.flush(),
    close: async () => {
      settlePending();
      if (isRunning()) {
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
