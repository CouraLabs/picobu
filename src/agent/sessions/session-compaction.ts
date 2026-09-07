import { generateText, Output, type UIMessage } from "ai";
import { z } from "zod";
import { compactorPrompt } from "@agent/prompts/compactor.ts";
import { resolveModel } from "@agent/model/resolver.ts";
import type { AiReasoningEffort, LoopMessageMetadata } from "@agent/loop/create-loop.ts";
import type { ProviderModelReasoningEffort } from "@config/options.ts";

export const COMPACT_THRESHOLD = 0.8;
export const shouldCompact = (contextUsed: number, contextWindow: number): boolean =>
  contextWindow > 0 && contextUsed / contextWindow >= COMPACT_THRESHOLD;

const MAX_TOOL_CHARS = 200;
const abbreviate = (value: unknown): string => {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TOOL_CHARS ? `${flat.slice(0, MAX_TOOL_CHARS)}…` : flat;
};
type LoosePart = {
  type: string;
  text?: unknown;
  state?: unknown;
  toolName?: unknown;
  input?: unknown;
  output?: unknown;
  errorText?: unknown;
};
const isToolPart = (part: LoosePart): boolean =>
  part.type === "dynamic-tool" || part.type.startsWith("tool-");
const toolPartName = (part: LoosePart): string =>
  part.type === "dynamic-tool" ? String(part.toolName ?? "unknown") : part.type.slice("tool-".length);

export const serializeForCompaction = (messages: UIMessage[]): string =>
  messages
    .flatMap((m) => {
      if (m.role !== "user" && m.role !== "assistant") return [];
      const lines = (m.parts as LoosePart[]).flatMap((part): string[] => {
        if (part.type === "text") {
          const text = typeof part.text === "string" ? part.text.trim() : "";
          return text ? [`${m.role}: ${text}`] : [];
        }
        if (part.type === "reasoning") return []; 
        if (isToolPart(part)) {
          return [`tool ${toolPartName(part)} (${String(part.state ?? "unknown")}): ${abbreviate(part.input)} -> ${abbreviate(part.output ?? part.errorText)}`];
        }
        return [];
      });
      return lines;
    })
    .join("\n");

const CompactedSchema = z.object({
  summary: z.string().min(1),
});
export type CompactSessionParams = {
  messages: UIMessage[];
  modelKey: string;
  thinking?: ProviderModelReasoningEffort;
};
export type CompactResult = {
  summary: string;
  cutMessageId: string;
  forkedSessionId?: string;
};

export const isCompactionCut = (message: UIMessage | undefined): boolean => {
  const meta = message?.metadata as LoopMessageMetadata | undefined;
  return meta?.compaction !== undefined;
};

export function messagesForLlm<M extends UIMessage>(messages: M[]): M[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!isCompactionCut(messages[i])) continue;
    return messages.slice(i);
  }
  return messages;
}

const COMPACTION_HEADER = "[Session compacted";
export { COMPACTION_HEADER };

export const compactedMessageText = (summary: string): string =>
  `${COMPACTION_HEADER} — the earlier conversation was replaced by this summary.]\n\n${summary}`;

export async function compactSession({
  messages,
  modelKey,
  thinking,
}: CompactSessionParams): Promise<{ summary: string }> {
  const transcript = serializeForCompaction(messages);
  if (!transcript) throw new Error("Nothing to compact: the session has no content");
  const { model } = resolveModel(modelKey);
  const { output } = await generateText({
    model,
    output: Output.object({ schema: CompactedSchema }),
    system: compactorPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as AiReasoningEffort as any } : {}),
  });
  return { summary: output.summary };
}
