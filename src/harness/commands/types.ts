import type { SessionBindings } from "./bindings";

export type CommandKind = "system" | "workflow" | "skill";

/**
 * Where a command is available. Commands default to all three flags; a flag
 * omitted from a command's list makes it unavailable in that mode:
 * - `code` — the coding tab / TUI session
 * - `web` — the web (xterm.js) surface; omitting it makes the command
 *   terminal-only (e.g. `/quit`, which would kill a browser tab's session)
 * - `persitent` — the persistent tab (spec spelling)
 */
export type CommandFlag = "code" | "web" | "persitent";

export type Command = {
  kind: CommandKind;
  /** Canonical invocation token, without the leading '/'. */
  name: string;
  /** Extra invocation tokens (system-only today), e.g. ["q","exit"] for quit. */
  aliases: string[];
  /** Display label (name, or skill/workflow frontmatter name). */
  title: string;
  /** Display blurb in the picker. Skills are skipped when empty. */
  description: string;
  /** SKILL.md / workflow .md path; "" for system commands. */
  path: string;
  /** Session modes / surfaces where the command is available; all when omitted. */
  flags?: CommandFlag[];
  /** System-only; receives the raw params string (e.g. "high" for /effort high). */
  handler?: (args: string, bindings: SessionBindings) => void | Promise<void>;
};