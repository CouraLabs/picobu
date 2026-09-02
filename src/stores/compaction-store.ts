import { createStore } from "@xstate/store-react";

export type CompactionState = {
  /** Bumped on every `/compact`; subscribers re-check to run the compaction. */
  requestId: number;
};

/**
 * Signal bus for manual compaction. The `/compact` system command only has
 * `(args, bindings)` — no access to the live session — so it bumps `requestId`
 * and the mounted SessionProvider subscribes and runs the compaction with its
 * own messages and model config.
 */
export const compactionStore = createStore({
  context: { requestId: 0 } as CompactionState,
  on: {
    request: (s) => ({ requestId: s.requestId + 1 }),
  },
});
