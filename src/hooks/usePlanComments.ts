import { useSelector } from "@xstate/store-react";
import { interactionStore, type PlanComment } from "../stores/interaction-store";

/**
 * Module-level fallback so the `useSelector` snapshot stays reference-stable:
 * a selector must never allocate (a fresh `[]` each call makes
 * `useSyncExternalStore` re-render forever — "Maximum update depth exceeded").
 */
const NO_COMMENTS: PlanComment[] = [];

/** Per-part plan review comments for the given session (empty when none). */
export const usePlanComments = (sessionId: string, partKey: string): PlanComment[] =>
  useSelector(interactionStore, (s) => s.context.planWriteComments[sessionId]?.[partKey] ?? NO_COMMENTS);
