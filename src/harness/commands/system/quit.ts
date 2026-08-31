import type { Command } from "../types";

/**
 * `/quit` (/q, /exit) — gracefully exits the app via the session's onExit hook.
 * Unavailable on web (`web` flag omitted): closing the browser tab is the
 * web way out, and a remote viewer shouldn't kill the served session.
 */
export const quit: Command = {
  kind: "system",
  name: "quit",
  aliases: ["q", "exit"],
  flags: ["code", "persitent"],
  title: "quit",
  description: "Quits the app",
  path: "",
  handler: (_args, bindings) => bindings.fireExit(),
};