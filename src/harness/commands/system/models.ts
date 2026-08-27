import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";

/** `/models` — opens the model picker (same as Ctrl+M). */
export const models: Command = {
  kind: "system",
  name: "models",
  aliases: [],
  title: "models",
  description: "Opens the model picker",
  path: "",
  handler: () => loopStore.trigger.openModelPicker(),
};