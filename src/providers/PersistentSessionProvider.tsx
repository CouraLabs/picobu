import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { z } from "zod";
import { loopStore } from "../stores/loop-store";
import { createLoop } from "../harness/agent/factory/loop/create-loop";
import { useRunMetrics } from "../hooks/useRunMetrics";
import { generateSessionTitle } from "../libs/session-title";
import { sessionTitleStore } from "../stores/session-title-store";
import { resolveCommandPrompt, commandModeFor } from "../harness/commands";
import { useSessionBindings } from "./SessionBindings";
import {
  persistentTurnFilePath,
  dropUnansweredPrompt,
  sanitizeMessages,
  SessionSaver,
} from "../libs/sessions";
import type { PromptFile } from "../libs/embeds";

export type PersistentSession = {
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

export const PersistentSessionContext = createContext<PersistentSession | null>(null);

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
    sendAutomaticallyWhen: () => false,
  });

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

  const stop = useCallback(() => {
    chatStop();
    // Same contract as the coding session: an interrupted prompt with no
    // response yet is removed along with its bare assistant stub.
    setMessages((msgs) => sanitizeMessages(dropUnansweredPrompt(msgs)));
  }, [chatStop, setMessages]);

  const onPrompt = (text?: string, files: PromptFile[] = []) => {
    if (!text && files.length === 0) return;
    const t = text ?? "";
    // Slash commands resolve in the persistent mode: commands flagged
    // `code`-only (e.g. /new, /sessions) are consumed with a toast.
    if (t.startsWith("/")) {
      void resolveCommandPrompt(
        t,
        bindings,
        commandModeFor("persistent", bindings.frontend === "web"),
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
  };

  const submitOrDefer = (t: string, files: PromptFile[]) => {
    if (streaming) {
      stop();
      pendingRef.current = { text: t, files };
      return;
    }
    startTurn(t, files);
  };

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

  const value: PersistentSession = {
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
  };

  return <PersistentSessionContext.Provider value={value}>{children}</PersistentSessionContext.Provider>;
};
