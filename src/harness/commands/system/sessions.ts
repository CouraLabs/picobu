import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";

/** `/sessions` — opens the saved-sessions picker for the current folder. */
export const sessions: Command = {
  kind: "system",
  name: "sessions",
  aliases: [],
  flags: ["code"],
  title: "sessions",
  description: "Lists saved sessions; pick one to resume it",
  path: "",
  handler: () => loopStore.trigger.openSessionsPicker(),
};
