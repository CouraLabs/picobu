import type { Command } from "../types";
import { loopStore, THINKING_LEVELS } from "../../../stores/loop-store";
import type { ProviderModelReasoningEffort } from "../../../libs/options";

/**
 * `/effort [level]` — without an argument opens the effort picker; with a
 * valid level sets the thinking effort directly. Invalid levels are ignored.
 */
export const effort: Command = {
  kind: "system",
  name: "effort",
  aliases: ["think"],
  title: "effort",
  description: "Show or set thinking effort (/effort high)",
  path: "",
  handler: (args) => {
    const lvl = args.trim();
    if (!lvl) {
      loopStore.trigger.openEffort();
      return;
    }
    if ((THINKING_LEVELS as string[]).includes(lvl)) {
      loopStore.trigger.setThinking({ thinking: lvl as ProviderModelReasoningEffort });
    }
    // invalid level: ignore silently
  },
};