import { useEffect, useRef, useState } from "react";

type RunPart = {
  type: string;
  state?: string;
  text?: string;
  id?: string;
};

type RunMessage = {
  id?: string;
  role: string;
  parts: RunPart[];
  metadata?: unknown;
};

export type RunUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };

/** Stable key for a reasoning part so its timing survives renders across the run. */
export const thinkingPartKey = (messageId: string, partIndex: number, partId?: string): string =>
  `${messageId}:${partId ?? partIndex}`;

export type RunMetrics = {
  markPromptSent: () => void;
  hasSession: boolean;
  elapsedSec: number;
  ttftMs: number | null;
  streamMs: number | null;
  thinkingTimes: Record<string, number>;
  tokensPerSec: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  usage: RunUsage | undefined;
};

/**
 * Session/run timing for a coding chat. `markPromptSent()` is called on each
 * user-submitted prompt; the session timer then runs continuously (even between
 * runs) until remount. We also track time-to-first-token, total stream, the time
 * spent streaming the model's reasoning (thinking), token throughput and the
 * running session timer.
 *
 * Reasoning is timed per part (keyed by message/part identity) rather than as a
 * single scalar, so each reasoning block in a multi-run session shows its own
 * duration. Per-run scalar milestones (ttft, stream) are reset in
 * `markPromptSent()`; within a run they are set with `??=` idempotently.
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
  const runStartAtRef = useRef<number | null>(null);
  const firstTokenAtRef = useRef<number | null>(null);
  const streamStartAtRef = useRef<number | null>(null);
  const finishedAtRef = useRef<number | null>(null);
  const thinkingRef = useRef<Map<string, { startAt: number; doneAt: number | null }>>(new Map());
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
    // Reset per-run milestones so each run measures its own ttft and stream
    // duration instead of carrying over the previous run's values.
    runStartAtRef.current = Date.now();
    firstTokenAtRef.current = null;
    streamStartAtRef.current = null;
    finishedAtRef.current = null;
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
  // Reasoning timing, per part: each reasoning part streams independently, so key
  // start/done by message + part identity rather than a session-wide scalar.
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    m.parts.forEach((p, i) => {
      if (p.type !== "reasoning") return;
      const key = thinkingPartKey(m.id ?? "", i, p.id);
      const rec = thinkingRef.current.get(key);
      if (!rec) {
        if (p.state === "streaming" && (p.text ?? "").trim().length > 0) {
          thinkingRef.current.set(key, { startAt: now, doneAt: null });
        }
        return;
      }
      if (rec.doneAt === null && p.state === "done") {
        rec.doneAt = now;
      }
    });
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
  const cacheReadTokens = keptUsage?.cacheReadTokens ?? null;
  const cacheWriteTokens = keptUsage?.cacheWriteTokens ?? null;

  // ---- derived (render-time) ----
  const sessionStartAt = sessionStartAtRef.current;
  const elapsedSec = sessionStartAt === null ? 0 : (now - sessionStartAt) / 1000;
  const streamStartAt = streamStartAtRef.current;
  const finishedAt = finishedAtRef.current;
  const ttftMs =
    firstTokenAtRef.current !== null && runStartAtRef.current !== null
      ? firstTokenAtRef.current - runStartAtRef.current
      : null;
  const streamMs = streamStartAt !== null && finishedAt !== null ? finishedAt - streamStartAt : null;
  const thinkingTimes: Record<string, number> = {};
  for (const [key, rec] of thinkingRef.current) {
    if (rec.doneAt !== null) thinkingTimes[key] = rec.doneAt - rec.startAt;
  }
  const tokensPerSec = outputTokens && streamMs ? (1000 * outputTokens) / streamMs : null;

  return { markPromptSent, hasSession, elapsedSec, ttftMs, streamMs, thinkingTimes, tokensPerSec, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, usage: keptUsage ?? undefined };
};