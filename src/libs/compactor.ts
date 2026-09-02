import { randomUUID } from "node:crypto";
import { generateObject, type UIMessage } from "ai";
import { z } from "zod";
import { compactorPrompt } from "../harness/agent/prompts/compactor";
import { resolveModel } from "../harness/agent/factory/provider-resolver";
import type { ProviderModelReasoningEffort } from "./options";

/** Compaction triggers when used context reaches this share of the window. */
export const COMPACT_THRESHOLD = 0.8;

/** True when `contextUsed` tokens hit the compaction threshold of the window. */
export const shouldCompact = (contextUsed: number, contextWindow: number): boolean =>
  contextWindow > 0 && contextUsed / contextWindow >= COMPACT_THRESHOLD;

/** Tool-call lines are abbreviated to this length in the transcript. */
const MAX_TOOL_CHARS = 200;

/** Flatten any value to a short single-line string for the transcript. */
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

/**
 * Render a conversation as a plain-text transcript for the compactor model:
 * user/assistant text verbatim, tool calls one abbreviated line each,
 * reasoning dropped. Pure so it is directly unit-testable.
 */
export const serializeForCompaction = (messages: UIMessage[]): string =>
  messages
    .flatMap((m) => {
      if (m.role !== "user" && m.role !== "assistant") return [];
      const lines = (m.parts as LoosePart[]).flatMap((part): string[] => {
        if (part.type === "text") {
          const text = typeof part.text === "string" ? part.text.trim() : "";
          return text ? [`${m.role}: ${text}`] : [];
        }
        if (part.type === "reasoning") return []; // stream-only thinking adds nothing
        if (isToolPart(part)) {
          return [`tool ${toolPartName(part)} (${String(part.state ?? "unknown")}): ${abbreviate(part.input)} -> ${abbreviate(part.output ?? part.errorText)}`];
        }
        return [];
      });
      return lines;
    })
    .join("\n");

/** AI SDK reasoning union cast boundary (mirrors session-title/create-loop). */
type AiReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "provider-default";

const CompactedSchema = z.object({
  summary: z.string().min(1),
});

export type CompactSessionParams = {
  messages: UIMessage[];
  modelKey: string;
  thinking?: ProviderModelReasoningEffort;
};

export type CompactResult = {
  /** The fresh conversation: a single user message carrying the summary. */
  messages: UIMessage[];
  summary: string;
};

/** Header wrapping the summary inside the fresh session's first message. */
export const compactedMessageText = (summary: string): string =>
  `[Session compacted — the earlier conversation was replaced by this summary.]\n\n${summary}`;

/**
 * Compact a conversation with a one-shot structured-output call. Uses the
 * currently running model (`modelKey`) with the compactor prompt; returns the
 * new (much shorter) message list. Throws on model failure — callers surface
 * the error and keep the un-compacted session.
 */
export async function compactSession({
  messages,
  modelKey,
  thinking,
}: CompactSessionParams): Promise<CompactResult> {
  const transcript = serializeForCompaction(messages);
  if (!transcript) throw new Error("Nothing to compact: the session has no content");
  const { model } = resolveModel(modelKey);
  const { object } = await generateObject({
    model,
    schema: CompactedSchema,
    system: compactorPrompt,
    prompt: transcript,
    ...(thinking !== undefined ? { reasoning: thinking as AiReasoningEffort } : {}),
  });
  return {
    messages: [
      {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: compactedMessageText(object.summary) }],
      },
    ],
    summary: object.summary,
  };
}
