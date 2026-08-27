import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { z } from "zod";
import { loopStore } from "../../stores/loop-store";
import { createLoop } from "../../harness/agent/factory/loop/create-loop";
import { useRunMetrics } from "../../hooks/useRunMetrics";
import { resolveCommandPrompt } from "../../harness/commands";
import { useRunCompletionNotification } from "../../hooks/useRunCompletionNotification";

export type CodingSession = {
  messages: UIMessage[];
  streaming: boolean;
  onPrompt: (text?: string) => void;
  elapsedSec: number;
  ttftMs: number | null;
  thinkingMs: number | null;
  tokensPerSec: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheTokens: number | null;
};

const CodingSessionContext = createContext<CodingSession | null>(null);

export const useCodingSession = (): CodingSession => {
  const ctx = useContext(CodingSessionContext);
  if (!ctx) throw new Error("useCodingSession must be used within <CodingSessionProvider>");
  return ctx;
};

/**
 * Owns the live coding loop (transport + chat + metrics) so it survives page
 * switches. Mounted above the router outlet; an in-flight run keeps streaming
 * even while the user browses Home. Also fires completion alerts.
 */
export const CodingSessionProvider = ({ children }: { children: ReactNode }) => {
  const { transport } = useMemo(() => createLoop(() => loopStore.getSnapshot().context), []);

  const { messages, sendMessage, status } = useChat({
    transport,
    messageMetadataSchema: z.object({
      usage: z.object({
        inputTokens: z.number().optional(),
        outputTokens: z.number().optional(),
        cacheTokens: z.number().optional(),
      }).optional(),
      finishReason: z.string().optional(),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const streaming = status === "submitted" || status === "streaming";

  const {
    markPromptSent,
    hasSession,
    elapsedSec,
    ttftMs,
    thinkingMs,
    tokensPerSec,
    inputTokens,
    outputTokens,
    cacheTokens,
  } = useRunMetrics({ status, messages });

  useRunCompletionNotification(streaming, hasSession);

  const submit = (text: string) => {
    markPromptSent();
    sendMessage({ text });
  };

  const onPrompt = (text?: string) => {
    if (!text) return;
    if (!text.startsWith("/")) {
      submit(text);
      return;
    }
    void resolveCommandPrompt(text).then((res) => {
      if (res.handled) {
        if (res.prompt !== undefined) submit(res.prompt);
        return;
      }
      submit(text); // unknown command / "/ " prompt -> passthrough
    });
  };

  const value: CodingSession = {
    messages,
    streaming,
    onPrompt,
    elapsedSec,
    ttftMs,
    thinkingMs,
    tokensPerSec,
    inputTokens,
    outputTokens,
    cacheTokens,
  };

  return <CodingSessionContext.Provider value={value}>{children}</CodingSessionContext.Provider>;
};