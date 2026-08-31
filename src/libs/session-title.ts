import { generateText } from "ai";
import { options, resolveModelRole } from "./options";
import { resolveModel } from "../harness/agent/factory/provider-resolver";

/** AI SDK reasoning union cast boundary (mirrors create-loop). */
type AiReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "provider-default";

const MAX_PROMPT_CHARS = 2000;

/**
 * Generate a short session title with the `tiny` role model. Best-effort:
 * falls back to a truncated prompt when the model call fails or no model is
 * configured, so callers can treat the result as always-present.
 */
export async function generateSessionTitle(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  const fallback = trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
  if (!trimmed) return fallback;
  try {
    const { modelKey, thinking } = resolveModelRole(options.harness, "tiny");
    const { model } = resolveModel(modelKey);
    const { text } = await generateText({
      model,
      reasoning: thinking as AiReasoningEffort,
      prompt: [
        "Generate a concise session title (max 6 words) for a coding agent session.",
        "Reply with the title only: no quotes, no trailing punctuation, no explanation.",
        "",
        "User request:",
        trimmed.slice(0, MAX_PROMPT_CHARS),
      ].join("\n"),
    });
    const title = (text.split("\n")[0] ?? "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    return title || fallback;
  } catch {
    return fallback; // the prompt itself is a usable title
  }
}
