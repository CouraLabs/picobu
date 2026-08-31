import { useCallback } from "react";
import { useRenderer } from "@opentui/react";
import { footerToastStore } from "../stores/footer-toast-store";

/**
 * Copies text to the system clipboard (OSC 52) and surfaces the footer
 * "Copied to clipboard!" toast for 5 seconds. The timer resets on each copy.
 */
export const useCopyToClipboard = (): ((text: string) => void) => {
  const renderer = useRenderer();

  return useCallback(
    (text: string) => {
      if (!text) return;
      renderer.copyToClipboardOSC52(text);
      footerToastStore.trigger.show({ message: "Copied to clipboard!" });
    },
    [renderer],
  );
};
