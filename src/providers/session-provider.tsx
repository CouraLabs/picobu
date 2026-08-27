import { createContext, useMemo, type ReactNode } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { z } from "zod";
import { loopStore } from "../stores/loop-store";
import { createLoop } from "../harness/agent/factory/loop/create-loop";
import { useRunMetrics } from "../hooks/useRunMetrics";
import { resolveCommandPrompt } from "../harness/commands";
import { useRunCompletionNotification } from "../hooks/useRunCompletionNotification";
import type { PromptFile } from "../libs/embeds";

export type CodingSession = {
  messages: UIMessage[];
  streaming: boolean;
  onPrompt: (text?: string, files?: PromptFile[]) => void;
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
 */
export const CodingSessionProvider = ({ children }: { children: ReactNode }) => {
  const { transport } = useMemo(() => createLoop(() => loopStore.getSnapshot().context), []);

  const { messages, sendMessage, status } = useChat({
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

  const submit = (text: string, files: PromptFile[]) => {
    markPromptSent();
    if (files.length) sendMessage({ text, files });
    else sendMessage({ text });
  };

  const onPrompt = (text?: string, files: PromptFile[] = []) => {
    if (!text && files.length === 0) return;
    if (!text) {
      submit("", files);
      return;
    }
    if (!text.startsWith("/")) {
      submit(text, files);
      return;
    }
    void resolveCommandPrompt(text).then((res) => {
      if (res.handled) {
        if (res.prompt !== undefined) submit(res.prompt, files);
        return;
      }
      submit(text, files); // unknown command / "/ " prompt -> passthrough
    });
  };

  const value: CodingSession = {
    messages,
    streaming,
    onPrompt,
    elapsedSec,
    ttftMs,
    thinkingTimes,
    tokensPerSec,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  };

  return <CodingSessionContext.Provider value={value}>{children}</CodingSessionContext.Provider>;
};