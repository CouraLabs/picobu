import { createStore } from "@xstate/store-react";

export type FooterToastState = {
  message: string | null;
};

const TOAST_MS = 5000;

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Single footer notification slot. Any component (clipboard copies, settings
 * saves, ...) calls `show`, and the toast auto-hides after 5 seconds; each
 * show resets the timer.
 */
export const footerToastStore = createStore({
  context: { message: null } as FooterToastState,
  on: {
    show: (_s, e: { message: string }) => {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => footerToastStore.trigger.hide(), TOAST_MS);
      return { message: e.message };
    },
    hide: () => ({ message: null }),
  },
});
