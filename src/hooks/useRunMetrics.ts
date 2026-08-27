import { useEffect, useRef, useState } from "react";

type RunPart = {
  type: string;
  state?: string;
  text?: string;
};

type RunMessage = {
  role: string;
  parts: RunPart[];
  metadata?: unknown;
};

export type RunUsage = { inputTokens?: number; outputTokens?: number; cacheTokens?: number };

export type RunMetrics = {
  markPromptSent: () => void;
  hasSession: boolean;
  elapsedSec: number;
  ttftMs: number | null;
  streamMs: number | null;
  thinkingMs: number | null;
  tokensPerSec: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheTokens: number | null;
  usage: RunUsage | undefined;
};

/**
 * Session/run timing for a coding chat. `markPromptSent()` is called when the
 * user submits the first prompt; the session timer then runs continuously (even
 * between runs) until remount. We also track time-to-first-token, total stream,
 * the time spent streaming the model's reasoning (thinking), token throughput
 * and the running session timer.
 *
 * All milestone refs are set with `??=` so updates are idempotent across renders.
 */
export const useRunMetrics = ({
  status,
  messages,
}: {
  status: string;
  messages: RunMessage[];
}): RunMetrics => {
  const [now, setNow] = useState(() => Date.now());

  const sessionStartAtRef = useRef<number | null>(null);
  const firstTokenAtRef = useRef<number | null>(null);
  const streamStartAtRef = useRef<number | null>(null);
  const finishedAtRef = useRef<number | null>(null);
  const thinkingStartAtRef = useRef<number | null>(null);
  const thinkingDoneAtRef = useRef<number | null>(null);
  const lastUsageRef = useRef<RunUsage | null>(null);

  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // Once the first prompt has been sent the session timer runs continuously,
    // even while idle between runs, so elapsedSec always reflects wall-clock
    // time since the first prompt.
    if (!hasSession) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [hasSession]);

  const markPromptSent = () => {
    if (sessionStartAtRef.current === null) {
      sessionStartAtRef.current = Date.now();
      // Start the timer independently of any other re-render so elapsedSec
      // begins ticking even if no status change follows (e.g. a failed send).
      setNow(sessionStartAtRef.current);
      setHasSession(true);
    }
  };

  // ---- timing milestone updates (idempotent, safe to run every render) ----
  if (status === "streaming") {
    streamStartAtRef.current ??= now;
  }
  if ((status === "ready" || status === "error") && streamStartAtRef.current !== null) {
    finishedAtRef.current ??= now;
  }
  if (firstTokenAtRef.current === null && status === "streaming") {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant && lastAssistant.parts.some(
      (p) =>
        (p.type === "text" || p.type === "reasoning") &&
        p.state === "streaming" &&
        (p.text ?? "").trim().length > 0
    )) {
      firstTokenAtRef.current = now;
    }
  }
  // Thinking (reasoning) timing: capture when the reasoning part starts emitting
  // tokens and, once it stops streaming, when it finished — that duration is the
  // time the model spent streaming its thoughts.
  if (thinkingStartAtRef.current === null && status === "streaming") {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (lastAssistant?.parts.some(
      (p) => p.type === "reasoning" && p.state === "streaming" && (p.text ?? "").trim().length > 0
    )) {
      thinkingStartAtRef.current = now;
    }
  }
  if (thinkingStartAtRef.current !== null && thinkingDoneAtRef.current === null && status === "streaming") {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (
      lastAssistant &&
      lastAssistant.parts.some((p) => p.type === "reasoning") &&
      !lastAssistant.parts.some((p) => p.type === "reasoning" && p.state === "streaming")
    ) {
      thinkingDoneAtRef.current = now;
    }
  }

  // usage comes from the last assistant message's message-metadata.
  const usageMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const usage = (usageMsg?.metadata as { usage?: RunUsage } | undefined)?.usage;
  // Keep the last known usage so token counts don't flash to zero while a fresh
  // request streams before its finish-metadata arrives.
  if (usage) lastUsageRef.current = usage;
  const keptUsage = usage ?? lastUsageRef.current;
  const inputTokens = keptUsage?.inputTokens ?? null;
  const outputTokens = keptUsage?.outputTokens ?? null;
  const cacheTokens = keptUsage?.cacheTokens ?? null;

  // ---- derived (render-time) ----
  const sessionStartAt = sessionStartAtRef.current;
  const elapsedSec = sessionStartAt === null ? 0 : (now - sessionStartAt) / 1000;
  const streamStartAt = streamStartAtRef.current;
  const finishedAt = finishedAtRef.current;
  const ttftMs =
    firstTokenAtRef.current !== null && sessionStartAt !== null
      ? firstTokenAtRef.current - sessionStartAt
      : null;
  const streamMs = streamStartAt !== null && finishedAt !== null ? finishedAt - streamStartAt : null;
  const thinkingMs =
    thinkingStartAtRef.current !== null && thinkingDoneAtRef.current !== null
      ? thinkingDoneAtRef.current - thinkingStartAtRef.current
      : null;
  const tokensPerSec = outputTokens && streamMs ? (1000 * outputTokens) / streamMs : null;

  return { markPromptSent, hasSession, elapsedSec, ttftMs, streamMs, thinkingMs, tokensPerSec, inputTokens, outputTokens, cacheTokens, usage: keptUsage ?? undefined };
};