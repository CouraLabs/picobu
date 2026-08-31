import { createStore } from "@xstate/store-react";
import { resolveDefaultModelKey } from "../harness/agent/factory/provider-resolver";
import { listAgents } from "../harness/agent/factory/agent/registry";
import type { AgentCategory } from "../harness/agent/types/agent-type";
import type { ProviderModelReasoningEffort } from "../libs/options";

export const THINKING_LEVELS: ProviderModelReasoningEffort[] = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type LoopState = {
  agentId: string;
  modelKey: string;
  thinking: ProviderModelReasoningEffort;
  modelPickerOpen: boolean;
  commandOpen: boolean;
  commandQuery: string;
  commandSelected: number;
  effortOpen: boolean;
  sessionsOpen: boolean;
  sessionsSelected: number;
  /** Prompt-queue mode (ctrl+q): prompts submitted mid-run run after it finishes. */
  queueMode: boolean;
  /** Prompt-steering mode (ctrl+w): the next prompt stops the current run and takes over. */
  steeringMode: boolean;
};

export const loopStore = createStore({
  context: {
    agentId: "coder",
    modelKey: resolveDefaultModelKey(),
    thinking: "high",
    modelPickerOpen: false,
    commandOpen: false,
    commandQuery: "",
    commandSelected: 0,
    effortOpen: false,
    sessionsOpen: false,
    sessionsSelected: 0,
    queueMode: false,
    steeringMode: false,
  } as LoopState,
  on: {
    nextAgent: (state, event: { category?: AgentCategory }) => {
      // Only cycle agents bound to the active session-mode category.
      const ids = listAgents(event.category).map((a) => a.id);
      const i = ids.indexOf(state.agentId);
      if (!ids.length) return state;
      return {
        ...state,
        agentId: ids[(i + 1 + ids.length) % ids.length] ?? state.agentId,
      };
    },
    nextThinking: (state) => {
      const i = THINKING_LEVELS.indexOf(state.thinking);
      return {
        ...state,
        thinking:
          THINKING_LEVELS[(i + 1 + THINKING_LEVELS.length) % THINKING_LEVELS.length] ??
          state.thinking,
      };
    },
    setModel: (state, event: { modelKey: string }) => ({
      ...state,
      modelKey: event.modelKey,
    }),
    openModelPicker: (state) => ({ ...state, modelPickerOpen: true }),
    closeModelPicker: (state) => ({ ...state, modelPickerOpen: false }),
    openCommand: (state, event: { query: string }) => ({
      ...state,
      commandOpen: true,
      commandQuery: event.query,
      commandSelected: 0,
    }),
    closeCommand: (state) => ({ ...state, commandOpen: false }),
    setCommandSelected: (state, event: { index: number }) => ({
      ...state,
      commandSelected: event.index,
    }),
    setThinking: (state, event: { thinking: ProviderModelReasoningEffort }) => ({
      ...state,
      thinking: event.thinking,
    }),
    openEffort: (state) => ({ ...state, effortOpen: true }),
    closeEffort: (state) => ({ ...state, effortOpen: false }),
    openSessionsPicker: (state) => ({
      ...state,
      sessionsOpen: true,
      sessionsSelected: 0,
    }),
    closeSessionsPicker: (state) => ({ ...state, sessionsOpen: false }),
    setSessionsSelected: (state, event: { index: number }) => ({
      ...state,
      sessionsSelected: event.index,
    }),
    // Queue and steering are mutually exclusive — enabling one disables the other.
    toggleQueueMode: (state) =>
      state.queueMode ? { ...state, queueMode: false } : { ...state, queueMode: true, steeringMode: false },
    toggleSteeringMode: (state) =>
      state.steeringMode ? { ...state, steeringMode: false } : { ...state, steeringMode: true, queueMode: false },
  },
});