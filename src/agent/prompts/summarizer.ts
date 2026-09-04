import { generateText } from "ai";
import type { UIMessage } from "ai";
import { resolveModel, resolveModelRef } from "@agent/model/resolver.ts";
import { computeCost, type AiReasoningEffort, type LoopUsage } from "@agent/loop/create-loop.ts";
import { serializeForCompaction } from "@agent/sessions/session.ts";
import type { ProviderModelReasoningEffort } from "@config/options.ts";

/** System prompt for the one-shot conversation summary. */
export const summarizerPrompt =
`Summarize the conversation below for a coding-agent session. Capture, in this order:
1. The user's goal and any decisions that were made.
2. The work completed: files changed, commands run, findings.
3. The current state: what exists now, what was verified.
4. Anything pending or unresolved (open questions, failed steps, next steps).
Be factual and concise; do not invent work that is not in the transcript.`;

export type SummarizeParams = {
  messages: UIMessage[];
  modelKey: string;
  thinking?: ProviderModelReasoningEffort;
};

export type SummarizeResult = {
  summary: string;
  usage: LoopUsage;
  cost: number | undefined;
};

/**
 * One-shot LLM summary over the whole conversation. Read-only: the session's
 * history is never touched. Shares the compactor's transcript serialization.
 * Throws on model failure — callers surface the error.
 */
export async function summarizeSession({ messages, modelKey, thinking }: SummarizeParams): Promise<SummarizeResult> {
  const transcript = serializeForCompaction(messages);
  if (!transcript) throw new Error("Nothing to summarize: the session has no content");
  const { model } = resolveModel(modelKey);
  const { text, usage } = await generateText({
    model,
    system: summarizerPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as AiReasoningEffort as any } : {}),
  });
  const summary = text.trim();
  if (!summary) throw new Error("The model returned an empty summary");
  const loopUsage: LoopUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  };
  let billing;
  try {
    billing = resolveModelRef(modelKey).modelMeta.billing;
  } catch {
    billing = undefined;
  }
  return { summary, usage: loopUsage, cost: computeCost(loopUsage, billing) };
}
