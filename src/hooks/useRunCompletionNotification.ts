import { useEffect, useRef } from "react";
import { notifyCompletion } from "../libs/notify";

/**
 * Fires the terminal bell + OS notification when a run finishes. `streaming`
 * flips false after a completed (or failed) run, so we detect the falling edge
 * of the streaming flag once a session has been initialized.
 */
export const useRunCompletionNotification = (streaming: boolean, hasSession: boolean) => {
  const prevStreamingRef = useRef(streaming);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (wasStreaming && !streaming && hasSession) {
      notifyCompletion("PICOBU run complete");
    }
  }, [streaming, hasSession]);
};