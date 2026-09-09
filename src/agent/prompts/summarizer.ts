import type { AiReasoningEffort } from "@agent/loop/create-loop.ts";
import { computeCost, type LoopUsage } from "@agent/model/cost.ts";
import { resolveModel, resolveModelRef } from "@agent/model/resolver.ts";
import { serializeForCompaction } from "@agent/sessions/session-compaction.ts";
import type { ProviderModelBilling, ProviderModelReasoningEffort } from "@config/options.ts";
import type { UIMessage } from "ai";
import { generateText } from "ai";

export const summarizerPrompt = `Summarize the conversation below for a coding-agent session. Capture, in this order:
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
  let billing: ProviderModelBilling | undefined;
  try {
    billing = resolveModelRef(modelKey).modelMeta.billing;
  } catch {
    billing = undefined;
  }
  return { summary, usage: loopUsage, cost: computeCost(loopUsage, billing) };
}
