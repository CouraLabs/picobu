import { createStore } from "@xstate/store-react";

export type SessionTitleState = {
  /** Title of the coding session (generated from its first user prompt). */
  coding: string | null;
  /** Title of the persistent session (generated from the latest prompt). */
  persistent: string | null;
};

/**
 * Generated session titles, one per session mode, rendered in the
 * SESSION_TITLE slot of the sessions page header.
 */
export const sessionTitleStore = createStore({
  context: {
    coding: null,
    persistent: null,
  } as SessionTitleState,
  on: {
    setCodingTitle: (state, event: { title: string | null }) => ({ ...state, coding: event.title }),
    setPersistentTitle: (state, event: { title: string | null }) => ({ ...state, persistent: event.title }),
  },
});
