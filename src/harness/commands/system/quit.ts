import type { Command } from "../types";
import { fireExit } from "../bindings";

/** `/quit` (/q, /exit) — gracefully exits the app via the shared onExit hook. */
export const quit: Command = {
  kind: "system",
  name: "quit",
  aliases: ["q", "exit"],
  title: "quit",
  description: "Quits the app",
  path: "",
  handler: () => fireExit(),
};