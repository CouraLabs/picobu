import { useKeyboard } from "@opentui/react";
import { loopStore } from "../stores/loop-store";
import { acceptCommand, filterCommands } from "../harness/commands";

/**
 * Global keybinds for the coding loop. While `streaming` is true, ALL keys are
 * swallowed (preventDefault + stopPropagation) so the user can't interrupt the
 * agent's step processing — that blocks the prompt submit, agent/thinking/model
 * switching and typing in the textarea alike.
 */
export const useLoopKeybinds = (streaming = false) => {
  useKeyboard((key) => {
    const state = loopStore.getSnapshot().context;

    if (streaming) {
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
        const n = filterCommands(state.commandQuery).length;
        if (n) loopStore.trigger.setCommandSelected({ index: (state.commandSelected - 1 + n) % n });
        return;
      }
      if (key.name === "down") {
        key.preventDefault();
        key.stopPropagation();
        const n = filterCommands(state.commandQuery).length;
        if (n) loopStore.trigger.setCommandSelected({ index: (state.commandSelected + 1) % n });
        return;
      }
      if (key.name === "tab" && !key.shift) {
        key.preventDefault();
        key.stopPropagation();
        const selected = filterCommands(state.commandQuery)[state.commandSelected];
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
      return;
    }
    if (state.modelPickerOpen || state.effortOpen) return; // pickers trap keys: up/down/return navigate, esc handled above
    if (key.name === "tab" && !key.shift) {
      key.preventDefault();
      key.stopPropagation();
      loopStore.trigger.nextAgent();
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