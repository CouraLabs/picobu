import { createStore } from "@xstate/store-react";
import { resolveDefaultModelKey } from "../harness/agent/factory/provider-resolver";
import { DEFAULT_AGENT_ROLE, listAgents } from "../harness/agent/factory/agent/registry";
import { options, resolveModelRole, type ProviderModelReasoningEffort } from "../libs/options";
import type { AgentCategory } from "../harness/agent/types/agent-type";

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
  /** WhatsApp contacts picker (`/wwp:contacts`). */
  contactsOpen: boolean;
  /** OAuth provider picker (`/login` / `/logout`). */
  authPickerOpen: boolean;
  /** Picker purpose: log in to or log out of a provider. */
  authPickerMode: "login" | "logout";
  /** Prompt-queue mode (ctrl+q): prompts submitted mid-run run after it finishes. */
  queueMode: boolean;
  /** Prompt-steering mode (ctrl+w): the next prompt stops the current run and takes over. */
  steeringMode: boolean;
  /** Model-role assignment picker (`/model-roles`). */
  rolePickerOpen: boolean;
};

/**
 * Model + thinking config for an agent's bound model role, applied whenever
 * the active agent changes so `harness.modelRoles` actually drives the run.
 * A role without an explicit thinking override (`flash`/`heavy` inherit the
 * model's default effort) leaves `thinking` unset so the current effort stays.
 * Empty when the agent has no bound role or the harness has no usable
 * `defaultModel` (resolution throws) — the current values stay in that case.
 */
export const agentRoleConfig = (agentId: string): { modelKey?: string; thinking?: ProviderModelReasoningEffort } => {
  const role = DEFAULT_AGENT_ROLE[agentId];
  if (!role) return {};
  try {
    const { modelKey, thinking } = resolveModelRole(options.harness, role);
    // `thinking` must be omitted (not `undefined`) when unset: spreading it
    // would clobber the user's current effort and crash the status bar.
    return { modelKey, ...(thinking !== undefined ? { thinking } : {}) };
  } catch {
    return {};
  }
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
    contactsOpen: false,
    authPickerOpen: false,
    authPickerMode: "login",
    queueMode: false,
    steeringMode: false,
    rolePickerOpen: false,
  } as LoopState,
  on: {
    nextAgent: (state, event: { category?: AgentCategory }) => {
      // Only cycle agents bound to the active session-mode category.
      const ids = listAgents(event.category).map((a) => a.id);
      const i = ids.indexOf(state.agentId);
      if (!ids.length) return state;
      const agentId = ids[(i + 1 + ids.length) % ids.length] ?? state.agentId;
      // Switching agents applies the agent's model role (documented defaults);
      // /models remains an explicit override after the switch.
      return { ...state, agentId, ...agentRoleConfig(agentId) };
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
    setAgent: (state, event: { agentId: string }) => ({
      ...state,
      agentId: event.agentId,
      ...agentRoleConfig(event.agentId),
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
    openContactsPicker: (state) => ({ ...state, contactsOpen: true }),
    closeContactsPicker: (state) => ({ ...state, contactsOpen: false }),
    openAuthPicker: (state, event: { mode: "login" | "logout" }) => ({
      ...state,
      authPickerOpen: true,
      authPickerMode: event.mode,
    }),
    closeAuthPicker: (state) => ({ ...state, authPickerOpen: false }),
    openRolePicker: (state) => ({ ...state, rolePickerOpen: true }),
    closeRolePicker: (state) => ({ ...state, rolePickerOpen: false }),
    // Queue and steering are mutually exclusive — enabling one disables the other.
    toggleQueueMode: (state) =>
      state.queueMode ? { ...state, queueMode: false } : { ...state, queueMode: true, steeringMode: false },
    toggleSteeringMode: (state) =>
      state.steeringMode ? { ...state, steeringMode: false } : { ...state, steeringMode: true, queueMode: false },
  },
});