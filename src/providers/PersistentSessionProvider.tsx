import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { loopStore } from "../stores/loop-store";
import { createLoop } from "../harness/agent/factory/loop/create-loop";
import { useRunMetrics } from "../hooks/useRunMetrics";
import { generateSessionTitle } from "../libs/session-title";
import { sessionTitleStore } from "../stores/session-title-store";
import { resolveCommandPrompt, commandModeFor } from "../harness/commands";
import { useSessionBindings } from "./SessionBindings";
import { messageMetadataSchema, makeStop, type RunSession } from "./session-run";
import { describeError, reportFromText, withSessionId, type ErrorReport } from "../libs/error-report";
import { persistentTurnFilePath, SessionSaver } from "../libs/sessions";
import type { PromptFile } from "../libs/embeds";
import { subscribeInbound, type InboundEvent } from "../integrations/whatsapp/bus";

export type PersistentSession = RunSession;

export const PersistentSessionContext = createContext<RunSession | null>(null);

/**
 * Persistent-session tab: each prompt is a fresh, stateless run — the loop's
 * `prepareCall` strips history to the latest user message and caps the run at
 * 10 agent steps (`sendAutomaticallyWhen: () => false` prevents the capped run
 * from re-submitting itself). Each turn is saved to
 * `~/.picobu/sessions/persitent/<timestamp>-<turn>.jsonl`. No queue/steering
 * here: `onPrompt` always submits (deferred until the current run ends).
 */

export const PersistentSessionProvider = ({ children }: { children: ReactNode }) => {
  const bindings = useSessionBindings();
  const { transport } = useMemo(
    () =>
      createLoop(() => ({
        ...loopStore.getSnapshot().context,
        agentId: "persistent",
        sessionMode: "persistent",
      })),
    [],
  );

  // Stream-level errors never reach `chat.error` — they arrive as masked
  // `errorText` chunks that only fire `onError` — so they are captured here.
  // Aborts surface the same way; they clear the error instead of setting one.
  const [streamError, setStreamError] = useState<string | null>(null);
  const { messages, sendMessage, status, error, stop: chatStop, setMessages } = useChat({
    transport,
    messageMetadataSchema,
    sendAutomaticallyWhen: () => false,
    onError: (err) => setStreamError(/abort/i.test(err.message) ? null : err.message),
  });

  // A new run resets the stream-level error (the SDK clears `chat.error` itself).
  useEffect(() => {
    if (status === "submitted") setStreamError(null);
  }, [status]);

  // Structured error from the transport (`chat.error`, e.g. a model-resolution
  // failure) wins; the serialized stream error is the fallback. Both are
  // tagged with the session id so the failing tab is identifiable.
  const runError: ErrorReport | null = useMemo(() => {
    const report = error ? describeError(error) : streamError ? reportFromText(streamError) : null;
    return report ? withSessionId(report, bindings.sessionId) : null;
  }, [error, streamError, bindings.sessionId]);

  const streaming = status === "submitted" || status === "streaming";

  const {
    elapsedSec,
    ttftMs,
    thinkingTimes,
    tokensPerSec,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cost,
  } = useRunMetrics({ status, messages });

  const turnRef = useRef(0);
  const turnStartRef = useRef(0);
  const saverRef = useRef<SessionSaver | null>(null);
  const pendingRef = useRef<{ text: string; files: PromptFile[] } | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const startTurn = (text: string, files: PromptFile[]) => {
    turnRef.current += 1;
    turnStartRef.current = messagesRef.current.length;
    saverRef.current = new SessionSaver(persistentTurnFilePath(Date.now(), turnRef.current));
    // Persistent sessions are stateless: the title tracks the latest prompt.
    if (text.trim()) {
      void generateSessionTitle(text)
        .then((title) => sessionTitleStore.trigger.setPersistentTitle({ title }))
        .catch(() => {});
    }
    if (files.length) sendMessage({ text, files });
    else sendMessage({ text });
  };

  const stop = makeStop(chatStop, setMessages);

  const submitOrDefer = useCallback(
    (t: string, files: PromptFile[]) => {
      if (streaming) {
        stop();
        pendingRef.current = { text: t, files };
        return;
      }
      startTurn(t, files);
    },
    // `startTurn` reads refs + setState only; `streaming`/`stop` are the live deps.
    [streaming, stop],
  );

  const onPrompt = useCallback(
    (text?: string, files: PromptFile[] = []) => {
      if (!text && files.length === 0) return;
      const t = text ?? "";
      // Slash commands resolve in the persistent mode: commands flagged
      // `code`-only (e.g. /new, /sessions) are consumed with a toast.
      if (t.startsWith("/")) {
        void resolveCommandPrompt(
          t,
          bindings,
          commandModeFor("persistent", bindings.frontend === "web", streaming),
        ).then((res) => {
          if (res.handled) {
            if (res.prompt !== undefined) submitOrDefer(res.prompt, files);
            return;
          }
          submitOrDefer(t, files); // unknown command / "/ " prompt -> passthrough
        });
        return;
      }
      submitOrDefer(t, files);
    },
    [submitOrDefer, bindings, streaming],
  );

  // Deferred send: a prompt submitted while streaming interrupts the run, then
  // starts once the stream settles.
  useEffect(() => {
    if (!streaming && pendingRef.current) {
      const p = pendingRef.current;
      pendingRef.current = null;
      startTurn(p.text, p.files);
    }
  }, [streaming]);

  // Incremental per-turn saver: debounced while streaming, immediate when idle.
  useEffect(() => {
    if (!saverRef.current) return;
    const turnMessages = messages.slice(turnStartRef.current);
    if (streaming) {
      const id = setTimeout(() => void saverRef.current!.save(turnMessages), 200);
      return () => clearTimeout(id);
    }
    void saverRef.current.save(turnMessages);
  }, [messages, streaming]);

  // Flush pending writes on unmount.
  useEffect(() => () => {
    void saverRef.current?.flush();
  }, []);

  // Bridge inbound integration events (WhatsApp messages, cron prompt
  // actions) into the persistent session. Events arriving while this provider
  // is unmounted queue in the bus and drain on the next mount. WhatsApp
  // messages carry a single-line origin header that instructs the agent to
  // answer via the `wwp-msg` tool; cron prompts keep the two-line label.
  // Routed through `submitOrDefer` (not `startTurn` directly) so an event
  // arriving mid-run interrupts and defers like any manual prompt. The ref
  // keeps the always-mounted subscription from capturing a stale `streaming`;
  // it is synced in an effect (never during render) so a discarded concurrent
  // render can't leave a torn value behind.
  const submitRef = useRef(submitOrDefer);
  useEffect(() => {
    submitRef.current = submitOrDefer;
  });
  useEffect(
    () =>
      subscribeInbound((event) =>
        submitRef.current(
          event.source === "whatsapp"
            ? `[${event.title}] ${event.text}`
            : `[${event.title}]\n${event.text}`,
          [],
        ),
      ),
    [],
  );

  const value: RunSession = useMemo(
    () => ({
      messages,
      streaming,
      error: runError,
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
      runError,
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

  return <PersistentSessionContext.Provider value={value}>{children}</PersistentSessionContext.Provider>;
};
