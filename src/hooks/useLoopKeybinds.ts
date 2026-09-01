import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import { loopStore } from "../stores/loop-store";
import { filterCommands, commandModeFor } from "../harness/commands";
import type { AgentCategory } from "../harness/agent/types/agent-type";
import { useSessionBindings } from "../providers/SessionBindings";


/**
 * Global keybinds for the coding loop. While `streaming` is true, all keys are
 * swallowed except ESC ESC (interrupt) so the user can't otherwise disturb the
 * agent's step processing — that blocks the prompt submit, agent/thinking/model
 * switching and typing in the textarea alike. Agent cycling (tab) is restricted
 * to the given session-mode category.
 */
export const useLoopKeybinds = (
  streaming = false,
  onInterrupt?: () => void,
  agentCategory?: AgentCategory,
) => {
  const { acceptCommand, frontend } = useSessionBindings();
  const lastEscapeRef = useRef(0);
  // Command availability follows the active tab's session mode flags.
  const commandMode = agentCategory ? commandModeFor(agentCategory, frontend === "web") : undefined;

  useKeyboard((key) => {
    const state = loopStore.getSnapshot().context;

    if (streaming) {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        const now = Date.now();
        if (lastEscapeRef.current !== 0 && now - lastEscapeRef.current < 400) {
          lastEscapeRef.current = 0;
          onInterrupt?.();
        } else {
          lastEscapeRef.current = now;
        }
        return;
      }
      // Queue/steering modes: let the user type and submit the next prompt
      // mid-run (the prompt submit path decides whether to queue or steer).
      // Everything else stays swallowed.
      if (state.queueMode || state.steeringMode) {
        const typeable =
          !key.ctrl &&
          !key.meta &&
          !key.option &&
          (key.name.length === 1 ||
            key.name === "space" ||
            key.name === "backspace" ||
            key.name === "return");
        if (typeable) return;
      }
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    if (state.commandOpen) {
      if (key.name === "escape") {
        key.preventDefault();
        key.stopPropagation();
        loopStore.trigger.closeCommand();
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
        key.stopPropagation();
        const n = filterCommands(state.commandQuery, commandMode).length;
        if (n) loopStore.trigger.setCommandSelected({ index: (state.commandSelected - 1 + n) % n });
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        const n = filterCommands(state.commandQuery, commandMode).length;
        if (n) loopStore.trigger.setCommandSelected({ index: (state.commandSelected + 1) % n });
        return;
      }
      if (key.name === "tab" && !key.shift) {
        key.preventDefault();
        key.stopPropagation();
        const selected = filterCommands(state.commandQuery, commandMode)[state.commandSelected];
        if (selected) acceptCommand(selected.name);
        loopStore.trigger.closeCommand();
        return;
      }
      return; // letters and Return pass through to the textarea; Return submits -> resolveCommandPrompt
    }

    if (key.name === "escape") {
      if (state.modelPickerOpen) {
        key.preventDefault();
        key.stopPropagation();
        loopStore.trigger.closeModelPicker();
      }
      if (state.effortOpen) {
        key.preventDefault();
        key.stopPropagation();
        loopStore.trigger.closeEffort();
      }
      if (state.sessionsOpen) {
        key.preventDefault();
        key.stopPropagation();
        loopStore.trigger.closeSessionsPicker();
      }
      if (state.contactsOpen) {
        key.preventDefault();
        key.stopPropagation();
        loopStore.trigger.closeContactsPicker();
      }
      return;
    }
    // Pickers trap keys: the focused select handles up/down/return, esc handled above.
    if (state.modelPickerOpen || state.effortOpen || state.sessionsOpen || state.contactsOpen) return;
    if (key.ctrl && key.name === "q") {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.toggleQueueMode();
      return;
    }
    if (key.ctrl && key.name === "w") {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.toggleSteeringMode();
      return;
    }
    if (key.name === "tab" && !key.shift) {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.nextAgent({ category: agentCategory });
      return;
    }
    if (key.name === "tab" && key.shift) {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.nextThinking();
      return;
    }
    if (key.ctrl && key.name === "m") {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.openModelPicker();
    }
  });
};