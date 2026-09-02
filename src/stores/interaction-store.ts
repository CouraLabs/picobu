import { createStore } from "@xstate/store-react";
import type { ProviderModelReasoningEffort } from "../libs/options";

export type AskOption = { answer: string; answerDescription: string };

export type AskQuestion = {
  title: string;
  question: string;
  type: "single" | "multiple";
  options: AskOption[];
};

export type AskAnswer = {
  title: string;
  question: string;
  type: "single" | "multiple";
  selections: string[];
  custom?: string;
};

export type AnsweredAsk = { answers: AskAnswer[]; summaryText: string };

export type PlanWriteStatus = "open" | "approved" | "rejected" | "dismissed";

export type PlanComment = { line: number; text: string; comment: string };

/**
 * Per-session agent override written by the `plan-exit` flow tool (Plan →
 * Coder handoff). Session-scoped so a handoff in one session can never
 * rewrite another session's agent selection — `loopStore.agentId` stays a
 * purely user-driven global. `modelKey`/`thinking` carry the new agent's
 * resolved role config; `undefined` falls back to the loop's current values.
 */
export type AgentOverride = { agentId: string; modelKey?: string; thinking?: ProviderModelReasoningEffort };

/**
 * Per-session state bridging flow-tool execution (harness side) and the
 * interactive UI (chat tool call renderers). Keyed by `sessionId` because in
 * web mode every tab shares one process and therefore one store singleton.
 *
 * - `agentOverride` — agent/model config applied by a flow-tool handoff.
 * - `answeredAsk` — per-tool-part summaries once the user confirmed answers.
 * - `planWriteStatus` — per-tool-part review outcome (`open` once the review
 *   dialog was shown, then `approved`/`rejected`/`dismissed` on user action).
 * - `planWriteComments` — per-tool-part line comments collected in the review
 *   dialog, so the footer buttons and re-renders keep them in sync.
 */
export type InteractionState = {
  agentOverride: Record<string, AgentOverride>;
  answeredAsk: Record<string, Record<string, AnsweredAsk>>;
  planWriteStatus: Record<string, Record<string, PlanWriteStatus>>;
  planWriteComments: Record<string, Record<string, PlanComment[]>>;
};

const upsertNested = <V,>(map: Record<string, Record<string, V>>, a: string, b: string, value: V): Record<string, Record<string, V>> =>
  ({ ...map, [a]: { ...map[a], [b]: value } });

export const interactionStore = createStore({
  context: {
    agentOverride: {},
    answeredAsk: {},
    planWriteStatus: {},
    planWriteComments: {},
  } as InteractionState,
  on: {
    setAgentOverride: (state, e: { sessionId: string; override: AgentOverride }) => ({
      ...state,
      agentOverride: { ...state.agentOverride, [e.sessionId]: e.override },
    }),
    clearAgentOverride: (state, e: { sessionId: string }) => {
      const { [e.sessionId]: _override, ...agentOverride } = state.agentOverride;
      return { ...state, agentOverride };
    },
    markAskAnswered: (state, e: { sessionId: string; partKey: string; answers: AskAnswer[]; summaryText: string }) => ({
      ...state,
      answeredAsk: upsertNested(state.answeredAsk, e.sessionId, e.partKey, {
        answers: e.answers,
        summaryText: e.summaryText,
      }),
    }),
    markPlanWriteOpen: (state, e: { sessionId: string; partKey: string }) => ({
      ...state,
      planWriteStatus: upsertNested(state.planWriteStatus, e.sessionId, e.partKey, "open"),
    }),
    markPlanWriteStatus: (state, e: { sessionId: string; partKey: string; status: PlanWriteStatus }) => ({
      ...state,
      planWriteStatus: upsertNested(state.planWriteStatus, e.sessionId, e.partKey, e.status),
    }),
    setPlanWriteComments: (state, e: { sessionId: string; partKey: string; comments: PlanComment[] }) => ({
      ...state,
      planWriteComments: upsertNested(
        state.planWriteComments,
        e.sessionId,
        e.partKey,
        // Comments stay ordered by line regardless of insertion order.
        [...e.comments].sort((a, b) => a.line - b.line),
      ),
    }),
    /** Drop all of a session's records — called when the session is switched away. */
    clearSession: (state, e: { sessionId: string }) => {
      const { [e.sessionId]: _override, ...agentOverride } = state.agentOverride;
      const { [e.sessionId]: _ask, ...answeredAsk } = state.answeredAsk;
      const { [e.sessionId]: _status, ...planWriteStatus } = state.planWriteStatus;
      const { [e.sessionId]: _comments, ...planWriteComments } = state.planWriteComments;
      return { ...state, agentOverride, answeredAsk, planWriteStatus, planWriteComments };
    },
  },
});

/** Imperative read of the session's agent override (loop config path). */
export const getAgentOverride = (sessionId: string): AgentOverride | undefined =>
  interactionStore.getSnapshot().context.agentOverride[sessionId];
