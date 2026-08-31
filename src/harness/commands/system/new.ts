import type { Command } from "../types";
import { generateSessionId } from "../../../libs/sessions";

/**
 * `/new` (/cls, /clear) — start a fresh session. The current session file
 * stays on disk (sessions are only saved after the first prompt, so a
 * no-prompt session leaves nothing behind).
 */
export const newSession: Command = {
  kind: "system",
  name: "new",
  aliases: ["cls", "clear"],
  flags: ["code"],
  title: "new",
  description: "Starts a new session (the current one stays saved)",
  path: "",
  handler: (_args, bindings) => bindings.switchSession(generateSessionId()),
};