import { useCallback } from "react";
import type { UIMessage } from "ai";
import { z } from "zod";
import type { PromptFile } from "../libs/embeds";
import { dropUnansweredPrompt, sanitizeMessages } from "../libs/sessions";

type Sanitize<M> = (msgs: M[]) => M[];

/**
 * Shape shared by both session runtimes (coding + persistent): the same
 * message/streaming/metrics surface consumed by the chat UI. The two providers
 * differ in transport, persistence and queueing behavior, not in this contract.
 */
export type RunSession = {
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
  cost: number | null;
};

/** Usage/cost metadata parsed from every streamed message chunk. */
export const messageMetadataSchema = z.object({
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cacheReadTokens: z.number().optional(),
      cacheWriteTokens: z.number().optional(),
    })
    .optional(),
  finishReason: z.string().optional(),
  cost: z.number().optional(),
});

/**
 * Shared interrupt contract: abort the active response (partial tokens stay;
 * status -> ready), strip any dangling tool-call parts so the interrupted
 * message is safe to re-send and to save, and drop the prompt entirely when it
 * never produced a response (nothing but the user message / a bare assistant
 * stub).
 */
export const makeStop = <M>(
  chatStop: () => void,
  setMessages: (updater: (msgs: M[]) => M[]) => void,
  // The sanitizer works on the structural UIMessage surface; `M` is the
  // transport's message type (structurally identical, see SessionProvider).
  sanitize: Sanitize<M> = sanitizeMessages as Sanitize<M>,
): (() => void) => {
  return useCallback(() => {
    chatStop();
    setMessages((msgs) => sanitize((dropUnansweredPrompt as Sanitize<M>)(msgs)));
  }, [chatStop, setMessages, sanitize]);
};
