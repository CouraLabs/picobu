import { createStore } from "@xstate/store-react";
import { resolveDefaultModelKey } from "../harness/agent/factory/provider-resolver";
import { listAgents } from "../harness/agent/factory/agent/registry";
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
  } as LoopState,
  on: {
    nextAgent: (state) => {
      const ids = listAgents().map((a) => a.id);
      const i = ids.indexOf(state.agentId);
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
  },
});