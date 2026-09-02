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

/** Rough tokens/sec numerator heuristic while streaming: ~4 characters of
 * streamed text per output token. Replaced by real usage at step finish. */
const CHARS_PER_TOKEN = 4;

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
  cost: number | null;
  usage: RunUsage | undefined;
};

/** Per-run streaming milestones, reset by `markPromptSent()` and set in effects. */
type Milestones = {
  firstTokenAt: number | null;
  streamStartAt: number | null;
  finishedAt: number | null;
};

const IDLE_MILESTONES: Milestones = { firstTokenAt: null, streamStartAt: null, finishedAt: null };

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
 * `markPromptSent()`; within a run they are set once, idempotently.
 *
 * All state is real React state and every update happens in an event handler
 * (`markPromptSent`) or an effect — nothing is mutated during render, so the
 * hook is safe under concurrent rendering.
 */
export const useRunMetrics = ({
  status,
  messages,
}: {
  status: string;
  messages: RunMessage[];
}): RunMetrics => {
  const [now, setNow] = useState(() => Date.now());
  const [hasSession, setHasSession] = useState(false);
  // Session-scoped milestones, written from the `markPromptSent` event handler.
  const [sessionStartAt, setSessionStartAt] = useState<number | null>(null);
  const [runStartAt, setRunStartAt] = useState<number | null>(null);
  // Per-run streaming milestones, written by the effect below.
  const [milestones, setMilestones] = useState<Milestones>(IDLE_MILESTONES);

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
    if (sessionStartAt === null) {
      const startedAt = Date.now();
      setSessionStartAt(startedAt);
      // Start the timer independently of any other re-render so elapsedSec
      // begins ticking even if no status change follows (e.g. a failed send).
      setNow(startedAt);
      setHasSession(true);
    }
    // Reset per-run milestones so each run measures its own ttft and stream
    // duration instead of carrying over the previous run's values.
    setRunStartAt(Date.now());
    setMilestones(IDLE_MILESTONES);
  };

  // ---- timing milestone updates (effect; guarded setState keeps it idempotent) ----
  useEffect(() => {
    const patch: Partial<Milestones> = {};
    if (status === "streaming" && milestones.streamStartAt === null) {
      patch.streamStartAt = Date.now();
    }
    if ((status === "ready" || status === "error") && milestones.streamStartAt !== null && milestones.finishedAt === null) {
      patch.finishedAt = Date.now();
    }
    if (status === "streaming" && milestones.firstTokenAt === null) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (lastAssistant && lastAssistant.parts.some(
        (p) =>
          (p.type === "text" || p.type === "reasoning") &&
          p.state === "streaming" &&
          (p.text ?? "").trim().length > 0
      )) {
        patch.firstTokenAt = Date.now();
      }
    }
    if (Object.keys(patch).length > 0) setMilestones((prev) => ({ ...prev, ...patch }));
  }, [status, messages, now, milestones]);

  // Reasoning timing, per part: each reasoning part streams independently, so key
  // start/done by message + part identity rather than a session-wide scalar.
  // The raw start/done map lives in a ref (mutable accumulator), updated in this
  // effect; completed durations are published as a plain record for render.
  const thinkingRef = useRef<Map<string, { startAt: number; doneAt: number | null }>>(new Map());
  const [thinkingTimes, setThinkingTimes] = useState<Record<string, number>>({});
  useEffect(() => {
    const map = thinkingRef.current;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      m.parts.forEach((p, i) => {
        if (p.type !== "reasoning") return;
        const key = thinkingPartKey(m.id ?? "", i, p.id);
        const rec = map.get(key);
        if (!rec) {
          if (p.state === "streaming" && (p.text ?? "").trim().length > 0) {
            map.set(key, { startAt: Date.now(), doneAt: null });
          }
          return;
        }
        if (rec.doneAt === null && p.state === "done") {
          rec.doneAt = Date.now();
        }
      });
    }
    const times: Record<string, number> = {};
    for (const [key, rec] of map) {
      if (rec.doneAt !== null) times[key] = rec.doneAt - rec.startAt;
    }
    setThinkingTimes((prev) => {
      const prevKeys = Object.keys(prev);
      const keys = Object.keys(times);
      if (prevKeys.length === keys.length && keys.every((k) => prev[k] === times[k])) return prev;
      return times;
    });
  }, [messages]);

  // usage (and the derived cost) come from the last assistant message's
  // message-metadata, which now updates per step (`finish-step`), not only at
  // the end of the run.
  const usageMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const usageMeta = usageMsg?.metadata as { usage?: RunUsage; cost?: number } | undefined;
  const usage = usageMeta?.usage;
  const metaCost = usageMeta?.cost ?? null;
  // Keep the last known usage/cost so token counts don't flash to zero while a
  // fresh request streams before its finish-metadata arrives.
  const [lastUsage, setLastUsage] = useState<RunUsage | null>(null);
  const [lastCost, setLastCost] = useState<number | null>(null);
  useEffect(() => {
    if (usage) setLastUsage(usage);
    if (metaCost !== null) setLastCost(metaCost);
  }, [usage, metaCost]);
  const keptUsage = usage ?? lastUsage;
  const inputTokens = keptUsage?.inputTokens ?? null;
  const outputTokens = keptUsage?.outputTokens ?? null;
  const cacheReadTokens = keptUsage?.cacheReadTokens ?? null;
  const cacheWriteTokens = keptUsage?.cacheWriteTokens ?? null;
  const cost = metaCost ?? lastCost;

  // ---- derived (render-time, pure) ----
  const elapsedSec = sessionStartAt === null ? 0 : (now - sessionStartAt) / 1000;
  const streamMs =
    milestones.streamStartAt !== null && milestones.finishedAt !== null
      ? milestones.finishedAt - milestones.streamStartAt
      : null;
  const ttftMs =
    milestones.firstTokenAt !== null && runStartAt !== null
      ? milestones.firstTokenAt - runStartAt
      : null;
  // Live throughput while streaming: estimate output tokens from the streamed
  // text/reasoning characters of the in-flight message (real usage only exists
  // at step boundaries); fall back to the exact usage/stream-duration once the
  // run settles.
  const liveStreamSec =
    status === "streaming" && milestones.firstTokenAt !== null ? (now - milestones.firstTokenAt) / 1000 : null;
  const streamedChars = liveStreamSec !== null
    ? [...messages].reverse().find((m) => m.role === "assistant")?.parts.reduce(
        (n, p) => n + (p.type === "text" || p.type === "reasoning" ? (p.text ?? "").length : 0),
        0,
      ) ?? 0
    : 0;
  const tokensPerSec =
    liveStreamSec !== null && liveStreamSec > 0.5 && streamedChars > 0
      ? streamedChars / CHARS_PER_TOKEN / liveStreamSec
      : outputTokens && streamMs
        ? (1000 * outputTokens) / streamMs
        : null;

  return { markPromptSent, hasSession, elapsedSec, ttftMs, streamMs, thinkingTimes, tokensPerSec, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, usage: keptUsage ?? undefined };
};
