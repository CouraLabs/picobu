import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { z } from "zod";
import { loopStore } from "../stores/loop-store";
import { createLoop, type LoopMessage } from "../harness/agent/factory/loop/create-loop";
import { useRunMetrics } from "../hooks/useRunMetrics";
import { resolveCommandPrompt } from "../harness/commands";
import { useRunCompletionNotification } from "../hooks/useRunCompletionNotification";
import { generateSessionTitle } from "../libs/session-title";
import { sessionTitleStore } from "../stores/session-title-store";
import { options } from "../libs/options";
import { commandModeFor } from "../harness/commands";
import { ensureOAuthTokens } from "../auth";
import {
  folderKeyFor,
  dropUnansweredPrompt,
  loadSession,
  sanitizeMessages,
  sessionFilePath,
  generateSessionId,
  SessionSaver,
} from "../libs/sessions";
import { compactSession, shouldCompact } from "../libs/compactor";
import { resolveModelRef } from "../harness/agent/factory/provider-resolver";
import { compactionStore } from "../stores/compaction-store";
import { footerToastStore } from "../stores/footer-toast-store";
import { messageMetadataSchema, makeStop, type RunSession } from "./session-run";
import type { PromptFile } from "../libs/embeds";
import { useSessionBindings } from "./SessionBindings";
import { interactionStore } from "../stores/interaction-store";


export type CodingSession = RunSession;

export const CodingSessionContext = createContext<CodingSession | null>(null);

/**
 * Owns the live coding loop (transport + chat + metrics) so it survives page
 * switches. Mounted above the router outlet; an in-flight run keeps streaming
 * even while the user browses Home. Also fires completion alerts.
 *
 * The conversation is persisted incrementally to
 * `~/.picobu/sessions/<folder>/<sessionId>.jsonl`; a resumed session loads its
 * messages before the first send. Queue (ctrl+q) and steering (ctrl+w) modes
 * decide what happens to prompts submitted while a run is streaming.
 */
export const CodingSessionProvider = ({ children }: { children: ReactNode }) => {
  const bindings = useSessionBindings();
  // Session id flows into the loop so session-scoped flow tools (todo) resolve
  // to this session's folder. `getConfig` runs per step, so any config change
  // (picker, plan-exit handoff) applies from the very next step.
  const { transport } = useMemo(
    () =>
      createLoop(() => {
        const base = loopStore.getSnapshot().context;
        return {
          ...base,
          sessionId: bindings.sessionId,
        };
      }),
    [bindings.sessionId],
  );

  const { messages, sendMessage, status, stop: chatStop, setMessages } = useChat({
    transport,
    messageMetadataSchema,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  // Load the persisted conversation once per session id (resume path). useChat
  // builds its Chat once, so a late-arriving `messages` option would never
  // re-seed it — seed the state directly once the load resolves.
  useEffect(() => {
    if (!bindings.sessionId) return;
    void loadSession(folderKeyFor(options.app.cwd), bindings.sessionId).then((loaded) => {
      if (loaded) {
        // Persisted JSON is structurally identical to the transport's messages;
        // the transport type is data-part-free, so narrow at this boundary (the
        // renderer's exhaustive switch is the safety net).
        const resumed = loaded as unknown as LoopMessage[];
        setMessages(resumed);
      }
    });
  }, [bindings.sessionId, setMessages]);

  const streaming = status === "submitted" || status === "streaming";

  const {
    markPromptSent,
    hasSession,
    elapsedSec,
    ttftMs,
    thinkingTimes,
    tokensPerSec,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cost,
    usage,
  } = useRunMetrics({ status, messages });

  useRunCompletionNotification(streaming, hasSession);

  // Session title: reset per session (a /new or /sessions switch gets a clean
  // slot), then generated once from the first user prompt via the tiny role
  // model (best-effort, fire-and-forget). The outgoing session's interaction
  // records (answers, plan reviews) are pruned on switch.
  const titleRequestedRef = useRef(false);
  useEffect(() => {
    titleRequestedRef.current = false;
    sessionTitleStore.trigger.setCodingTitle({ title: null });
    const sid = bindings.sessionId;
    return () => interactionStore.trigger.clearSession({ sessionId: sid });
  }, [bindings.sessionId]);
  useEffect(() => {
    if (titleRequestedRef.current) return;
    const firstUser = messages.find((m) => m.role === "user");
    const text = firstUser?.parts.find(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )?.text;
    if (!text) return;
    titleRequestedRef.current = true;
    void generateSessionTitle(text)
      .then((title) => sessionTitleStore.trigger.setCodingTitle({ title }))
      .catch(() => {});
  }, [messages]);

  // Incremental session saver: debounced while streaming, immediate when idle.
  // A session is only saved after its first prompt — an untouched session
  // writes nothing, so /new before any prompt leaves no file behind.
  const saverRef = useRef<SessionSaver>(
    new SessionSaver(sessionFilePath(folderKeyFor(options.app.cwd), bindings.sessionId)),
  );
  useEffect(() => {
    if (!messages.length) return;
    if (streaming) {
      const id = setTimeout(() => void saverRef.current.save(messages), 200);
      return () => clearTimeout(id);
    }
    void saverRef.current.save(messages);
  }, [messages, streaming]);
  useEffect(() => () => {
    void saverRef.current.flush();
  }, []);

  // Interrupt: see `makeStop` in session-run.ts.
  const stop = makeStop(chatStop, setMessages);

  // ---- session compaction (auto at 80% context, manual via /compact) ----
  // Refs mirror the live values so `runCompaction` (subscribed once / fired
  // from effects) never captures a stale conversation mid-run.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const streamingRef = useRef(streaming);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);
  const usageRef = useRef(usage);
  useEffect(() => {
    usageRef.current = usage;
  }, [usage]);
  const compactingRef = useRef(false);

  const runCompaction = useCallback(async () => {
    // Re-entrancy and mid-run guards: compaction is best-effort; a streaming
    // run or an in-flight compaction simply skips the request.
    if (compactingRef.current || streamingRef.current) return;
    const source = messagesRef.current;
    if (!source.length) return;
    compactingRef.current = true;
    const usedTokens =
      (usageRef.current?.inputTokens ?? 0) + (usageRef.current?.outputTokens ?? 0);
    footerToastStore.trigger.show({ message: "Compacting session…" });
    try {
      const config = loopStore.getSnapshot().context;
      const { messages: compacted } = await compactSession({
        messages: source,
        modelKey: config.modelKey,
        thinking: config.thinking,
      });
      // The new session file must exist before the switch: the old session is
      // already fully persisted (incremental saver), and the remount below
      // loads the compacted file from disk.
      const newId = generateSessionId();
      const saver = new SessionSaver(sessionFilePath(folderKeyFor(options.app.cwd), newId));
      await saver.save(compacted as unknown as LoopMessage[]);
      await saver.flush();
      const pct = Math.min(100, Math.round((usedTokens / Math.max(1, resolveModelRef(config.modelKey).modelMeta.context)) * 100));
      bindings.switchSession(newId);
      footerToastStore.trigger.show({
        message: `Session compacted (was ~${pct}% context) — continuing in a new session`,
      });
    } catch (error) {
      console.error("picobu: session compaction failed:", error);
      footerToastStore.trigger.show({
        message: "Compaction failed — the session was left unchanged",
      });
    } finally {
      compactingRef.current = false;
    }
  }, [bindings]);

  // Manual trigger: `/compact` bumps the store's requestId from anywhere
  // (system commands have no session access); the provider reacts here.
  const runCompactionRef = useRef(runCompaction);
  useEffect(() => {
    runCompactionRef.current = runCompaction;
  });
  useEffect(() => {
    const subscription = compactionStore.subscribe(() => void runCompactionRef.current());
    return () => subscription.unsubscribe();
  }, []);

  // Auto trigger: after a run settles, when used context (input + output of
  // the last step — the current conversation size, matching the status-bar
  // metric) reaches 80% of the model's window.
  useEffect(() => {
    if (streaming || !usage) return;
    let contextWindow = 0;
    try {
      contextWindow = resolveModelRef(loopStore.getSnapshot().context.modelKey).modelMeta.context;
    } catch {
      return; // unconfigured model — nothing to measure against
    }
    const used = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    if (shouldCompact(used, contextWindow)) void runCompaction();
  }, [streaming, usage, runCompaction]);

  const sendNow = useCallback(
    async (text: string, files: PromptFile[]) => {
      markPromptSent();
      // Refresh OAuth tokens (a cached pass) so the sync per-step model
      // resolution never sees a stale auth-ref token mid-run.
      await ensureOAuthTokens().catch(() => {});
      if (files.length) sendMessage({ text, files });
      else sendMessage({ text });
    },
    [sendMessage, markPromptSent],
  );

  // Prompt-queue mode: prompts submitted mid-run are queued FIFO and drain when idle.
  const [queue, setQueue] = useState<{ text: string; files: PromptFile[] }[]>([]);
  // Prompt-steering mode: the latest mid-run prompt interrupts and replaces the run.
  const [pendingSteer, setPendingSteer] = useState<{ text: string; files: PromptFile[] } | null>(null);

  // Stable identities: these flow into the session context, so a fresh function
  // per render would re-render every consumer (and re-fire effects listing
  // `onPrompt` as a dep) on every stream chunk.
  const submit = useCallback(
    (text: string, files: PromptFile[]) => {
      const s = loopStore.getSnapshot().context;
      if (s.steeringMode && streaming) {
        setPendingSteer({ text, files });
        stop();
        return;
      }
      if (s.queueMode && streaming) {
        setQueue((q) => [...q, { text, files }]);
        return;
      }
      sendNow(text, files);
    },
    [streaming, stop, sendNow],
  );

  // Drain the queue FIFO regardless of whether queueMode is still on (accepted
  // prompts always run).
  useEffect(() => {
    if (!streaming && queue.length > 0) {
      const [next, ...rest] = queue;
      if (next) {
        setQueue(rest);
        sendNow(next.text, next.files);
      }
    }
  }, [streaming, queue, sendNow]);

  // A new steer replaces any prior pending steer (last wins).
  useEffect(() => {
    if (!streaming && pendingSteer) {
      const p = pendingSteer;
      setPendingSteer(null);
      sendNow(p.text, p.files);
    }
  }, [streaming, pendingSteer, sendNow]);

  const onPrompt = useCallback(
    (text?: string, files: PromptFile[] = []) => {
      if (!text && files.length === 0) return;
      if (!text) {
        submit("", files);
        return;
      }
      if (!text.startsWith("/")) {
        submit(text, files);
        return;
      }
      void resolveCommandPrompt(
        text,
        bindings,
        // `streamingRef` (not the state) keeps `onPrompt` identity stable
        // across stream chunks; idle-only commands gate on the live value.
        commandModeFor("coding", bindings.frontend === "web", streamingRef.current),
      ).then((res) => {
        if (res.handled) {
          if (res.prompt !== undefined) submit(res.prompt, files);
          return;
        }
        submit(text, files); // unknown command / "/ " prompt -> passthrough
      });
    },
    [submit, bindings],
  );

  const value: CodingSession = useMemo(
    () => ({
      messages,
      streaming,
      onPrompt,
      stop,
      elapsedSec,
      ttftMs,
      thinkingTimes,
      tokensPerSec,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
    }),
    [
      messages,
      streaming,
      onPrompt,
      stop,
      elapsedSec,
      ttftMs,
      thinkingTimes,
      tokensPerSec,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cost,
    ],
  );

  return <CodingSessionContext.Provider value={value}>{children}</CodingSessionContext.Provider>;
};
