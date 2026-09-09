import type { AiReasoningEffort } from "@agent/loop/create-loop.ts";
import { resolveModel } from "@agent/model/resolver.ts";
import { options, resolveModelRole } from "@config/options.ts";
import { truncate } from "@shared/text-stats.ts";
import { generateText } from "ai";

export const sessionTitlePrompt = [
  "Generate a concise thread title for conversation retrieval.",
  "Output MUST be a single line, ≤50 chars, no explanations.",
  "Match input language and maintain natural grammar.",
  "Focus on user intent/topic; omit 'a', 'an', 'the', 'this', 'my'.",
  "Preserve exact technical terms, numbers, filenames, and HTTP codes.",
  "For files, focus on intended action rather than sharing.",
  "For brief/casual greetings, output intent (e.g., 'Greeting', 'Light chat').",
  "Never use tools, answer questions, or include words like 'summarizing'.",
  "Examples: 'refactor user service' -> 'Refactoring user service', '@App.tsx add dark mode' -> 'Dark mode toggle in App'.",
].join("\n");

const MAX_PROMPT_CHARS = 2000;

export async function generateSessionTitle(prompt: string): Promise<string> {
  const trimmed = prompt.trim();
  const fallback = truncate(trimmed);
  if (!trimmed) return fallback;
  try {
    const { modelKey, thinking } = resolveModelRole(options.harness, "tiny");
    const { model } = resolveModel(modelKey);
    const { text } = await generateText({
      model,
      reasoning: thinking as AiReasoningEffort as any,
      prompt: [sessionTitlePrompt, "", "User request:", trimmed.slice(0, MAX_PROMPT_CHARS)].join("\n"),
    });
    const title = (text.split("\n")[0] ?? "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();
    return title || fallback;
  } catch {
    return fallback;
  }
}
