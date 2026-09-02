import type { Command } from "../types";
import { loopStore } from "../../../stores/loop-store";

/** `/model-roles` — show the harness model roles and assign a model to each. */
export const modelRoles: Command = {
  kind: "system",
  name: "model-roles",
  aliases: ["roles"],
  title: "model-roles",
  description: "Show and assign the model for each harness model role",
  path: "",
  handler: () => loopStore.trigger.openRolePicker(),
};