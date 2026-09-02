import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { useSelector } from "@xstate/store-react";
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
  SessionSaver,
} from "../libs/sessions";
import type { PromptFile } from "../libs/embeds";
import { useSessionBindings } from "./SessionBindings";
import { getAgentOverride, interactionStore } from "../stores/interaction-store";


export type CodingSession = {
  messages: UIMessage[];
  streaming: boolean;
  onPrompt: (text?: string, files?: PromptFile[]) => void;
  stop: () => void;
  elapsedSec: number;
  ttftMs: number | null;
  thinkingTimes: Record<string, number>;
  tokensPerSec: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

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
  // to this session's folder. A flow-tool handoff (`plan-exit`) writes a
  // per-session agent override that supersedes the global picker for this
  // session until the user manually picks an agent again. `getConfig` runs per
  // step, so a handoff written mid-run applies from the very next step.
  const globalAgentId = useSelector(loopStore, (s) => s.context.agentId);
  const { transport } = useMemo(
    () =>
      createLoop(() => {
        const base = loopStore.getSnapshot().context;
        const override = getAgentOverride(bindings.sessionId);
        return {
          ...base,
          sessionId: bindings.sessionId,
          ...(override
            ? {
                agentId: override.agentId,
                modelKey: override.modelKey ?? base.modelKey,
                thinking: override.thinking ?? base.thinking,
              }
            : {}),
        };
      }),
    [bindings.sessionId],
  );

  // A manual agent selection supersedes any automatic plan-exit handoff.
  useEffect(() => {
    if (getAgentOverride(bindings.sessionId)) {
      interactionStore.trigger.clearAgentOverride({ sessionId: bindings.sessionId });
    }
  }, [globalAgentId, bindings.sessionId]);

  const { messages, sendMessage, status, stop: chatStop, setMessages } = useChat({
    transport,
    messageMetadataSchema: z.object({
      usage: z.object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        cacheReadTokens: z.number().optional(),
        cacheWriteTokens: z.number().optional(),
      }).optional(),
      finishReason: z.string().optional(),
    }),
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
  } = useRunMetrics({ status, messages });

  useRunCompletionNotification(streaming, hasSession);

  // Session title: reset per session (a /new or /sessions switch gets a clean
  // slot), then generated once from the first user prompt via the tiny role
  // model (best-effort, fire-and-forget). The outgoing session's interaction
  // records (answers, plan reviews, handoff overrides) are pruned on switch.
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

  // Interrupt: abort the active response (partial tokens stay; status -> ready),
  // strip any dangling tool-call parts so the interrupted message is safe
  // to re-send and to save, and drop the prompt entirely when it never
  // produced a response (nothing but the user message / a bare assistant stub).
  const stop = useCallback(() => {
    chatStop();
    setMessages((msgs) => sanitizeMessages(dropUnansweredPrompt(msgs)));
  }, [chatStop, setMessages]);

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
        commandModeFor("coding", bindings.frontend === "web"),
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
    ],
  );

  return <CodingSessionContext.Provider value={value}>{children}</CodingSessionContext.Provider>;
};
