import { useEffect, useRef, type RefObject } from "react";
import { notifyCompletion, notifyFailure } from "../libs/notify";
import type { ErrorReport } from "../libs/error-report";

type RunNotificationOptions = {
  /** Normalized error from the last run — a non-null value notifies as a failure. */
  error: ErrorReport | null;
  /** One-line metrics summary ("1m 02s · 12.5K out · $0.03") or null. */
  summary: string | null;
  /** Set by the provider when the user interrupts the run; consumes the
   * falling streaming edge so a manual stop stays silent. */
  interruptedRef: RefObject<boolean>;
};

/**
 * Fires the terminal bell + OS notification when a run finishes. `streaming`
 * flips false after a completed (or failed) run, so we detect the falling edge
 * of the streaming flag once a session has been initialized. Failures notify
 * with the error message; manual interrupts don't notify at all.
 */
export const useRunCompletionNotification = (
  streaming: boolean,
  hasSession: boolean,
  { error, summary, interruptedRef }: RunNotificationOptions,
) => {
  const prevStreamingRef = useRef(streaming);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (!wasStreaming || streaming || !hasSession) return;
    if (interruptedRef.current) {
      interruptedRef.current = false;
      return;
    }
    if (error) {
      notifyFailure(error.message);
      return;
    }
    notifyCompletion(summary ? `Run finished · ${summary}` : "Run complete");
  }, [streaming, hasSession, error, summary, interruptedRef]);
};
