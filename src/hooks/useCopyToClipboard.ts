import { useCallback, useRef } from "react";
import { useRenderer } from "@opentui/react";
import { copyToastStore } from "../stores/copy-toast-store";

const TOAST_MS = 5000;

/**
 * Copies text to the system clipboard (OSC 52) and surfaces the footer
 * "Copied to clipboard!" toast for 5 seconds. The timer resets on each copy.
 */
export const useCopyToClipboard = (): ((text: string) => void) => {
  const renderer = useRenderer();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (text: string) => {
      if (!text) return;
      renderer.copyToClipboardOSC52(text);
      copyToastStore.trigger.show();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => copyToastStore.trigger.hide(), TOAST_MS);
    },
    [renderer],
  );
};